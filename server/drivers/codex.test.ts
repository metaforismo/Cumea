// Codex driver contract tests, run against the scripted fake app-server
// in server/testing/fake-codex-app-server.ts — the driver must drive the
// JSON-RPC handshake, normalize notifications into canonical events, and
// surface server->client approval requests as request.opened.
//
// Spawn-based tests are POSIX-only until Windows CLI spawning lands (the
// fake is a shebang script — same constraint as codex.cmd itself).
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { CodexDriver } from "./codex.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-codex-app-server.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

describe("CodexDriver.decodeConfig", () => {
  it("defaults to the codex binary with fullAuto off", () => {
    expect(CodexDriver.decodeConfig({})).toEqual({ cli: "codex", fullAuto: false, rpcTimeoutMs: 60_000 });
    expect(CodexDriver.decodeConfig(undefined)).toEqual({ cli: "codex", fullAuto: false, rpcTimeoutMs: 60_000 });
    expect(CodexDriver.decodeConfig({ fullAuto: true }).fullAuto).toBe(true);
    // anything non-true is off — a truthy string must not enable full auto
    expect(CodexDriver.decodeConfig({ fullAuto: "yes" }).fullAuto).toBe(false);
    expect(() => CodexDriver.decodeConfig({ rpcTimeoutMs: 99 })).toThrow(/rpcTimeoutMs/);
  });
});

posixOnly("CodexDriver turns (fake app-server)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const create = async (opts: { mode?: string; fullAuto?: boolean; rpcTimeoutMs?: number } = {}) => {
    if (opts.mode) process.env.FAKE_CODEX_MODE = opts.mode;
    instance = await CodexDriver.create({
      instanceId: "codex-test",
      displayName: "Codex Test",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: opts.fullAuto ?? false, rpcTimeoutMs: opts.rpcTimeoutMs ?? 60_000 },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "cumea-codex-test-"));
  });

  afterEach(async () => {
    delete process.env.FAKE_CODEX_MODE;
    delete process.env.FAKE_CODEX_DUMP;
    delete process.env.OPENAI_API_KEY;
    recorder?.stop();
    await instance?.dispose();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("runs the handshake and normalizes a full turn", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CODEX_DUMP = dump;
    process.env.OPENAI_API_KEY = "sk-should-not-leak";

    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-happy",
      text: "list files",
      system: "You are Testy.",
    });
    await recorder.until((e) => e.type === "turn.completed");

    const types = recorder.events.map((e) => e.type);
    expect(types).toEqual([
      "turn.started",
      "session.started",
      "item.started", // commandExecution ls -la
      "item.completed", // commandExecution done
      "content.delta",
      "item.completed", // assistant_text
      "thread.token-usage.updated",
      "turn.completed",
    ]);
    expect(recorder.events.every((e) => e.turnId === turnId && e.provider === "codex")).toBe(true);
    expect(recorder.events.find((e) => e.type === "session.started")).toMatchObject({
      sessionId: "codex-thread-1",
      model: "fake-codex-model",
    });
    expect(recorder.events.find((e) => e.type === "thread.token-usage.updated")).toMatchObject({
      input: 7,
      output: 3,
    });
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.env.OPENAI_API_KEY).toBeUndefined();
    const methods = seen.calls.map((c: { method: string }) => c.method);
    expect(methods).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
    // persona rides in front of the prompt text — codex has no system slot
    const turnStart = seen.calls.at(-1);
    expect(turnStart.params.input[0].text).toBe("You are Testy.\n\nlist files");
  });

  it("mounts peer-agent MCP without putting the comms secret in argv", async () => {
    await create();
    const dump = join(scratch, "agents.json");
    process.env.FAKE_CODEX_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-agents",
      text: "ask the researcher",
      integrations: {
        agents: {
          command: process.execPath,
          args: ["/tmp/cumea-agents-proxy.js"],
          env: {
            ELECTRON_RUN_AS_NODE: "1",
            CUMEA_HARNESS_URL: "http://127.0.0.1:8799",
            CUMEA_BOT_ID: "captain",
            CUMEA_THREAD_ID: "t-agents",
            CUMEA_COMMS_TOKEN: "peer-comms-secret",
            CUMEA_TURN_DEPTH: "0",
          },
        },
      },
    });
    await recorder.until((event) => event.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const argv = seen.argv.join(" ");
    expect(argv).toContain("mcp_servers.agents.command");
    expect(argv).toContain("/tmp/cumea-agents-proxy.js");
    expect(argv).toContain("CUMEA_COMMS_TOKEN");
    expect(argv).not.toContain("peer-comms-secret");
    expect(seen.env.CUMEA_COMMS_TOKEN).toBe("peer-comms-secret");
    expect(instance.adapter.capabilities.agentsMcp).toBe(true);
  });

  it("mounts the validated local CUA stdio contract without leaking its env values in argv", async () => {
    await create();
    const dump = join(scratch, "local-computer.json");
    process.env.FAKE_CODEX_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-local-computer",
      text: "open the browser",
      integrations: {
        localComputer: {
          command: process.execPath,
          args: ["/tmp/cua-mcp.js", "--stdio"],
          env: {
            CUA_CONNECTION_TOKEN: "local-cua-secret",
            CUA_CONNECTION_PORT: "49152",
          },
        },
      },
    });
    await recorder.until((event) => event.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const argv = seen.argv.join(" ");
    expect(argv).toContain("mcp_servers.computer.command");
    expect(argv).toContain("/tmp/cua-mcp.js");
    expect(argv).toContain("CUA_CONNECTION_TOKEN");
    expect(argv).not.toContain("local-cua-secret");
    expect(seen.env.CUA_CONNECTION_TOKEN).toBe("local-cua-secret");
    expect(seen.env.CUA_CONNECTION_PORT).toBe("49152");
    expect(instance.adapter.capabilities.localComputerMcp).toBe(true);
  });

  it("mounts the packaged cloud computer proxy with Box credentials only in child env", async () => {
    await create();
    const dump = join(scratch, "cloud-computer.json");
    process.env.FAKE_CODEX_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-cloud-computer",
      text: "inspect the cloud desktop",
      integrations: {
        computer: { boxId: "box-codex-1", token: "box-token-secret" },
      },
    });
    await recorder.until((event) => event.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const argv = seen.argv.join(" ");
    expect(argv).toContain("mcp_servers.computer.command");
    expect(argv).toMatch(/computer-proxy\.(?:ts|js)/);
    expect(argv).toContain("CUMEA_BOX_TOKEN");
    expect(argv).not.toContain("box-token-secret");
    expect(seen.env.CUMEA_BOX_ID).toBe("box-codex-1");
    expect(seen.env.CUMEA_BOX_TOKEN).toBe("box-token-secret");
    expect(seen.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(instance.adapter.capabilities.cloudComputerMcp).toBe(true);
  });

  it("tries thread/resume with a cursor and reuses the thread id", async () => {
    await create({ mode: "resume" });
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CODEX_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-resume", text: "again", resumeCursor: "codex-thread-9" });
    const started = await recorder.until((e) => e.type === "session.started");
    expect(started).toMatchObject({ sessionId: "codex-thread-9" });
    await recorder.until((e) => e.type === "turn.completed");

    const methods = JSON.parse(readFileSync(dump, "utf8")).calls.map((c: { method: string }) => c.method);
    expect(methods).toContain("thread/resume");
    expect(methods).not.toContain("thread/start");
  });

  it("falls back to a fresh thread when resume fails", async () => {
    await create(); // fake rejects thread/resume outside resume mode
    await instance.adapter.sendTurn({ threadId: "t-fallback", text: "go", resumeCursor: "gone-thread" });
    const started = await recorder.until((e) => e.type === "session.started");
    expect(started).toMatchObject({ sessionId: "codex-thread-1" });
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("surfaces an approval request and forwards the user's decision", async () => {
    await create({ mode: "approval" });
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CODEX_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-approve", text: "clean up" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({ requestType: "permission", tool: "shell", summary: "rm -rf scratch" });

    await instance.adapter.respondToRequest("t-approve", opened.requestId!, { behavior: "allow" });
    const resolved = await recorder.until((e) => e.type === "request.resolved");
    expect(resolved).toMatchObject({ behavior: "allow", source: "user" });

    await recorder.until((e) => e.type === "turn.completed");
    // legacy method name → legacy decision vocabulary
    expect(JSON.parse(readFileSync(dump, "utf8")).decision).toEqual({ decision: "approved" });
  });

  it("auto-approves commands in fullAuto without opening a request", async () => {
    await create({ mode: "approval", fullAuto: true });
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CODEX_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-auto", text: "clean up" });
    await recorder.until((e) => e.type === "turn.completed");

    expect(recorder.events.some((e) => e.type === "request.opened")).toBe(false);
    expect(JSON.parse(readFileSync(dump, "utf8")).decision).toEqual({ decision: "approved" });
  });

  it("rejects a second turn while one is in flight", async () => {
    await create({ mode: "approval" }); // approval mode parks the turn open
    await instance.adapter.sendTurn({ threadId: "t-busy", text: "one" });
    await recorder.until((e) => e.type === "request.opened");
    await expect(instance.adapter.sendTurn({ threadId: "t-busy", text: "two" })).rejects.toThrow(/already running/);
    await instance.adapter.interruptTurn("t-busy");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("fails a turn when the app-server leaves an RPC unanswered", async () => {
    await create({ mode: "hang-initialize", rpcTimeoutMs: 100 });
    await instance.adapter.sendTurn({ threadId: "t-timeout", text: "go" });

    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "rpc_error" });
    expect(recorder.events.find((e) => e.type === "runtime.error")).toMatchObject({
      message: "initialize timed out after 100ms",
    });
  });

  it("a missing binary surfaces as a failed turn, and snapshot says unavailable", async () => {
    instance = await CodexDriver.create({
      instanceId: "codex-missing",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: join(scratch, "does-not-exist"), fullAuto: false, rpcTimeoutMs: 60_000 },
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({ threadId: "t-missing", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false });
    expect(await instance.snapshot()).toMatchObject({ state: "unavailable" });
  });
});
