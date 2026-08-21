// Claude driver contract tests, run against the scripted fake CLI in
// server/testing/fake-claude-cli.ts — the driver must normalize the
// stream-json protocol into canonical events, keep argv hygiene (prompt
// over stdin, secrets stripped), and broker permission asks.
//
// Spawn-based tests remain POSIX-only because this fixture is a shebang
// script. Windows command-shim resolution is covered in procs.test.ts.
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { ClaudeDriver, parseClaudeAuthStatus } from "./claude.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

describe("ClaudeDriver.decodeConfig", () => {
  it("defaults to the claude binary with acceptEdits", () => {
    expect(ClaudeDriver.decodeConfig({})).toEqual({ cli: "claude", permissionMode: "acceptEdits" });
    expect(ClaudeDriver.decodeConfig(undefined)).toEqual({ cli: "claude", permissionMode: "acceptEdits" });
  });

  it("accepts the three known permission modes", () => {
    for (const permissionMode of ["acceptEdits", "auto", "bypassPermissions"] as const) {
      expect(ClaudeDriver.decodeConfig({ permissionMode }).permissionMode).toBe(permissionMode);
    }
  });

  it("throws on an invalid permissionMode (registry downgrades this to a shadow)", () => {
    expect(() => ClaudeDriver.decodeConfig({ permissionMode: "yolo" })).toThrow(/permissionMode/);
  });
});

describe("parseClaudeAuthStatus", () => {
  it("accepts the documented JSON shape and a warning-prefixed JSON line", () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true}')).toBe(true);
    expect(parseClaudeAuthStatus('warning\n{"loggedIn":false}')).toBe(false);
  });

  it("fails open as unknown for empty, malformed, or future output", () => {
    expect(parseClaudeAuthStatus("")).toBeUndefined();
    expect(parseClaudeAuthStatus("not json")).toBeUndefined();
    expect(parseClaudeAuthStatus('{"status":"ok"}')).toBeUndefined();
  });
});

posixOnly("ClaudeDriver turns (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const create = async (mode?: string) => {
    if (mode) process.env.FAKE_CLAUDE_MODE = mode;
    instance = await ClaudeDriver.create({
      instanceId: "claude-test",
      displayName: "Claude Test",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, permissionMode: "acceptEdits" },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "cumea-claude-test-"));
  });

  afterEach(async () => {
    delete process.env.FAKE_CLAUDE_MODE;
    delete process.env.FAKE_CLAUDE_DUMP;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.BOX_TOKEN;
    recorder?.stop();
    await instance?.dispose();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("normalizes a full turn into the canonical event sequence", async () => {
    await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-happy", text: "hi", model: "claude-sonnet-5" });
    await recorder.until((e) => e.type === "turn.completed");

    const types = recorder.events.map((e) => e.type);
    expect(types).toEqual([
      "turn.started",
      "session.started",
      "content.delta",
      "item.completed", // assistant_text
      "item.started", // tool tu-1
      "thread.token-usage.updated",
      "item.completed", // tool tu-1 result
      "turn.completed",
    ]);
    expect(recorder.events.every((e) => e.turnId === turnId && e.provider === "claudeAgent")).toBe(true);

    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated")!;
    expect(usage).toMatchObject({ input: 12, output: 5 }); // input + cache_read
    const done = recorder.events.at(-1)!;
    expect(done).toMatchObject({ type: "turn.completed", ok: true, cost: 0.01 });
    expect(instance.adapter.hasSession("t-happy")).toBe(false);
  });

  it("sends the prompt over stdin, never argv, and strips identity env vars", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.ANTHROPIC_API_KEY = "sk-should-not-leak";
    process.env.XAI_API_KEY = "xai-should-not-leak";
    process.env.BOX_TOKEN = "box-should-not-leak";

    await instance.adapter.sendTurn({ threadId: "t-hygiene", text: "the secret prompt", system: "You are Testy." });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(JSON.stringify(seen.argv)).not.toContain("the secret prompt");
    expect(seen.prompt).toMatchObject({ type: "user", message: { role: "user", content: "the secret prompt" } });
    expect(seen.argv).toContain("--append-system-prompt");
    expect(seen.argv).toContain("--session-id");
    expect(seen.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(seen.env.XAI_API_KEY).toBeUndefined();
    expect(seen.env.BOX_TOKEN).toBeUndefined();
    expect(seen.env.CLAUDECODE).toBeUndefined();
    expect(seen.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
  });

  it("mounts peer-agent handoff tools when the harness supplies them", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-agents",
      text: "ask a teammate",
      integrations: {
        agents: { command: "/tmp/agents-proxy", args: ["serve"], env: { CUMEA_TEST: "1" } },
      },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const configIndex = seen.argv.indexOf("--mcp-config");
    const toolsIndex = seen.argv.indexOf("--allowedTools");
    expect(JSON.parse(seen.argv[configIndex + 1]).mcpServers.agents).toEqual({
      command: "/tmp/agents-proxy",
      args: ["serve"],
      env: { CUMEA_TEST: "1" },
    });
    expect(seen.argv[toolsIndex + 1]).toContain("mcp__agents");
    expect(instance.adapter.capabilities.agentsMcp).toBe(true);
  });

  it("mounts assigned local MCP servers without silently pre-approving their tools", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-custom-mcp",
      text: "use the assigned integration",
      integrations: {
        memory: { command: "/tmp/memory-proxy", args: [], env: { CUMEA_MEMORY_CAPABILITY: "opaque" } },
        mcpServers: [{
          name: "local_0123456789abcdef0123",
          command: "/tmp/private-mcp",
          args: ["--stdio"],
          env: { PRIVATE_TOKEN: "secret" },
        }],
      },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const configIndex = seen.argv.indexOf("--mcp-config");
    const toolsIndex = seen.argv.indexOf("--allowedTools");
    expect(JSON.parse(seen.argv[configIndex + 1]).mcpServers.local_0123456789abcdef0123).toEqual({
      command: "/tmp/private-mcp",
      args: ["--stdio"],
      env: { PRIVATE_TOKEN: "secret" },
    });
    expect(JSON.parse(seen.argv[configIndex + 1]).mcpServers.memory).toEqual({
      command: "/tmp/memory-proxy",
      args: [],
      env: { CUMEA_MEMORY_CAPABILITY: "opaque" },
    });
    expect(seen.argv[toolsIndex + 1]).not.toContain("local_0123456789abcdef0123");
    expect(seen.argv[toolsIndex + 1]).not.toContain("mcp__memory");
    expect(instance.adapter.capabilities.customMcp).toBe(true);
    expect(instance.adapter.capabilities.memoryMcp).toBe(true);
  });

  it("resumes with --resume when a cursor exists and reports that session id", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-resume", text: "again", resumeCursor: "sess-123" });
    const started = await recorder.until((e) => e.type === "session.started");
    expect(started).toMatchObject({ sessionId: "sess-123" });

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("--resume");
    expect(seen.argv).not.toContain("--session-id");
  });

  it("rejects a second turn while one is in flight", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-busy", text: "one" });
    await expect(instance.adapter.sendTurn({ threadId: "t-busy", text: "two" })).rejects.toThrow(/already running/);
    expect(instance.adapter.hasSession("t-busy")).toBe(true);
    await instance.adapter.interruptTurn("t-busy");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("interrupt kills the turn and settles it as failed, not hung", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-int", text: "go" });
    await recorder.until((e) => e.type === "session.started");

    await instance.adapter.interruptTurn("t-int");
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "exit_before_result" });
  });

  it("an exit before result becomes runtime.error + failed turn", async () => {
    await create("exit-early");
    await instance.adapter.sendTurn({ threadId: "t-crash", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "exit_before_result" });
    const error = recorder.events.find((e) => e.type === "runtime.error")!;
    expect(error.message).toContain("simulated crash");
  });

  it("skips malformed protocol lines without losing the turn", async () => {
    await create("malformed");
    await instance.adapter.sendTurn({ threadId: "t-noise", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it("a missing binary surfaces as spawn_error, and snapshot says unavailable", async () => {
    instance = await ClaudeDriver.create({
      instanceId: "claude-missing",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: join(scratch, "does-not-exist"), permissionMode: "acceptEdits" },
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({ threadId: "t-missing", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "spawn_error" });

    expect(await instance.snapshot()).toMatchObject({ state: "unavailable" });
  });

  it("uses the CLI auth status instead of guessing from a credential file", async () => {
    await create("auth-logged-out");
    await expect(instance.snapshot()).resolves.toMatchObject({
      state: "available",
      version: "2.1.211",
      authenticated: false,
    });
  });

  it("keeps an unrecognized legacy auth response unknown", async () => {
    await create("auth-malformed");
    const snapshot = await instance.snapshot();
    expect(snapshot).toMatchObject({ state: "available", version: "2.1.211" });
    expect(snapshot).not.toHaveProperty("authenticated");
  });

  it("brokers a permission ask into request.opened and answers over the socket", async () => {
    await create("hang");
    const dump = join(scratch, "broker.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-perm-abc", text: "go" });
    await recorder.until((e) => e.type === "session.started");

    // Read the exact opaque endpoint and handshake secret passed to the MCP
    // proxy. Neither value is derivable from the thread id.
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const configIndex = seen.argv.indexOf("--mcp-config");
    const mcp = JSON.parse(seen.argv[configIndex + 1]).mcpServers.cumea;
    const socketPath = mcp.args[1];
    const brokerSecret = mcp.env.CUMEA_PERMISSION_BROKER_SECRET;
    const conn = connect(socketPath);
    const answered = new Promise<{ behavior: string }>((resolve) => {
      let buf = "";
      conn.on("data", (c) => {
        buf += c;
        const nl = buf.indexOf("\n");
        if (nl !== -1) resolve(JSON.parse(buf.slice(0, nl)));
      });
    });
    await new Promise<void>((resolve, reject) => {
      conn.on("connect", resolve);
      conn.on("error", reject);
    });
    conn.write(JSON.stringify({ t: "auth", secret: brokerSecret }) + "\n");
    conn.write(JSON.stringify({ t: "ask", id: "ask-1", tool: "Bash", input: { command: "rm -rf scratch" } }) + "\n");

    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({
      requestType: "permission",
      tool: "Bash",
      summary: "rm -rf scratch",
      requestId: "ask-1",
    });

    await instance.adapter.respondToRequest("t-perm-abc", "ask-1", { behavior: "allow" });
    expect(await answered).toMatchObject({ behavior: "allow" });
    const resolved = await recorder.until((e) => e.type === "request.resolved");
    expect(resolved).toMatchObject({ behavior: "allow", source: "user" });

    conn.end();
    await instance.adapter.interruptTurn("t-perm-abc");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("rejects answers to unknown or already-resolved asks", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-perm-2", text: "go" });
    await expect(
      instance.adapter.respondToRequest("t-perm-2", "never-asked", { behavior: "allow" }),
    ).rejects.toThrow(/pending request/);
    await instance.adapter.interruptTurn("t-perm-2");
    await recorder.until((e) => e.type === "turn.completed");
  });
});
