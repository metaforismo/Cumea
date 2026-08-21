// ACP driver contract tests, run against the scripted fake ACP CLI in
// server/testing/fake-acp-cli.ts. Covers the shared acp/core.ts runtime via
// its two harness shims (grok = fail-closed auth, gemini = lenient auth):
// normalize the ACP handshake into canonical events, keep argv/env hygiene,
// broker permission asks, and settle interrupts/crashes cleanly.
//
// Spawn-based tests are POSIX-only until Windows CLI spawning lands (the fake
// CLI is a shebang script Windows cannot exec directly).
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../../config.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { recordEvents, type EventRecorder } from "../../testing/events.ts";
import { SecretCatalog } from "../../secret-egress.ts";
import { EventBus } from "../../harness/bus.ts";
import { GrokAgentDriver } from "./grok.ts";
import { GeminiAgentDriver } from "./gemini.ts";
import {
  CustomAcpDriver,
  customAcpInstance,
  decodeCustomAcpConfig,
  decodeCustomAcpProfileInput,
  publicCustomAcpProfile,
} from "./custom.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const RESTORED_ENV_KEYS = [
  "BOX_TOKEN",
  "COMPOSIO_API_KEY",
  "EXPO_ACCESS_TOKEN",
  "HTTP_PROXY",
  "SSH_AUTH_SOCK",
  "XAI_API_KEY",
] as const;

describe("ACP decodeConfig", () => {
  it("grok defaults to the grok binary", () => {
    expect(GrokAgentDriver.decodeConfig({})).toEqual({ cli: "grok", fullAuto: false, workspace: undefined });
  });
  it("gemini defaults to the gemini binary", () => {
    expect(GeminiAgentDriver.decodeConfig(undefined)).toEqual({ cli: "gemini", fullAuto: false, workspace: undefined });
  });
  it("fullAuto only when explicitly true", () => {
    expect(GrokAgentDriver.decodeConfig({ fullAuto: "yes" }).fullAuto).toBe(false);
    expect(GrokAgentDriver.decodeConfig({ fullAuto: true }).fullAuto).toBe(true);
  });

  it("validates a custom ACP subscription without accepting shell or secret environment fields", () => {
    const profile = decodeCustomAcpProfileInput({
      label: "My subscription",
      executable: "/usr/local/bin/my-agent",
      arguments: ["agent", "stdio", "--model", "{model}"],
      versionArguments: ["version"],
      models: [
        { id: "fast", label: "Fast" },
        { id: "deep", label: "Deep" },
      ],
      defaultModel: "deep",
      authMethod: "cached_token",
      requireAuthentication: true,
      workspace: process.cwd(),
      fullAuto: false,
      enabled: true,
    });
    expect(profile).not.toHaveProperty("environment");
    const instance = customAcpInstance(profile);
    expect(publicCustomAcpProfile("acp-local", instance)).toMatchObject({
      id: "acp-local",
      label: "My subscription",
      executable: "/usr/local/bin/my-agent",
      defaultModel: "deep",
      requireAuthentication: true,
    });
    expect(decodeCustomAcpConfig(instance.config).models.options).toHaveLength(2);
    expect(() => decodeCustomAcpProfileInput({
      ...profile,
      environment: { TOKEN: "must-not-be-accepted" },
    })).toThrow(/authenticate with the CLI/i);
  });

  it("rejects unknown argv placeholders and mismatched default models", () => {
    const base = {
      label: "Unsafe",
      executable: "agent",
      models: [{ id: "one", label: "One" }],
      defaultModel: "one",
    };
    expect(() => decodeCustomAcpProfileInput({ ...base, arguments: ["--token", "{secret}"] })).toThrow(/placeholder/i);
    expect(() => decodeCustomAcpProfileInput({ ...base, defaultModel: "two" })).toThrow(/defaultModel/i);
  });
});

posixOnly("ACP turns (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;
  let previousEnvironment: Record<string, string | undefined>;

  const create = async (driver = GrokAgentDriver, mode?: string) => {
    if (mode) process.env.FAKE_ACP_MODE = mode;
    instance = await driver.create({
      instanceId: "acp-test",
      displayName: "ACP Test",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    previousEnvironment = Object.fromEntries(RESTORED_ENV_KEYS.map((key) => [key, process.env[key]]));
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "cumea-acp-test-"));
  });

  afterEach(async () => {
    delete process.env.FAKE_ACP_MODE;
    delete process.env.FAKE_ACP_DUMP;
    for (const key of RESTORED_ENV_KEYS) {
      const previous = previousEnvironment[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    delete process.env.FAKE_ACP_REFLECT_SECRET;
    recorder?.stop();
    await instance?.dispose();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("normalizes a full turn into the canonical event sequence", async () => {
    await create();
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-happy",
      turnId: "harness-turn-acp",
      text: "hi",
      model: "grok-4.5",
    });
    expect(turnId).toBe("harness-turn-acp");
    await recorder.until((e) => e.type === "turn.completed");

    const types = recorder.events.map((e) => e.type);
    expect(types).toEqual([
      "turn.started",
      "session.started",
      "content.delta",
      "item.started", // tool tc-1
      "item.completed", // tool tc-1 done
      "thread.token-usage.updated",
      "item.completed", // assistant_text (summed) on settle
      "turn.completed",
    ]);
    expect(recorder.events.every((e) => e.turnId === turnId && e.provider === "grokAgent")).toBe(true);
    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated")!;
    expect(usage).toMatchObject({ input: 10, output: 5 });
    const text = recorder.events.find((e) => e.type === "item.completed" && (e as any).itemType === "assistant_text")!;
    expect((text as any).text).toBe("hello from fake acp");
    const done = recorder.events.at(-1)!;
    expect(done).toMatchObject({ type: "turn.completed", ok: true });
    expect(instance.adapter.hasSession("t-happy")).toBe(false);
  });

  it("passes ACP stdio flags and strips unrelated managed credentials from the child env", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.XAI_API_KEY = "xai-should-not-leak";
    process.env.BOX_TOKEN = "box-should-not-leak";

    await instance.adapter.sendTurn({ threadId: "t-hygiene", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("agent");
    expect(seen.argv).toContain("stdio");
    expect(seen.argv).toContain("--permission-mode");
    expect(seen.env.XAI_API_KEY).toBeUndefined();
    expect(seen.env.BOX_TOKEN).toBeUndefined();
  });

  it("keeps Gemini auth compatibility but withholds Cumea integration credentials", async () => {
    await create(GeminiAgentDriver, "no-auth");
    const dump = join(scratch, "gemini-env.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.GEMINI_API_KEY = "gemini-owned-key";
    process.env.XAI_API_KEY = "xai-unrelated";
    process.env.BOX_TOKEN = "box-unrelated";

    await instance.adapter.sendTurn({ threadId: "t-gemini-env", text: "go" });
    await recorder.until((event) => event.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.env.GEMINI_API_KEY).toBe("gemini-owned-key");
    expect(seen.env.XAI_API_KEY).toBeUndefined();
    expect(seen.env.BOX_TOKEN).toBeUndefined();
    delete process.env.GEMINI_API_KEY;
  });

  it("runs a configurable subscription profile with exact argv and model expansion", async () => {
    const dump = join(scratch, "custom-dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    const config = decodeCustomAcpConfig({
      cli: FAKE_CLI,
      args: ["--cumea-test-dump", dump, "agent", "stdio", "--model", "{model}"],
      versionArgs: ["--version"],
      models: {
        default: "custom-fast",
        options: [
          { id: "custom-fast", label: "Fast" },
          { id: "custom-deep", label: "Deep" },
        ],
      },
      authFailure: "continue",
      fullAuto: false,
    });
    instance = await CustomAcpDriver.create({
      instanceId: "custom-subscription",
      displayName: "Custom subscription",
      environment: {},
      enabled: true,
      config,
    });
    recorder = recordEvents(instance.adapter);
    expect(instance.models.default).toBe("custom-fast");
    expect(instance.adapter.capabilities.agentsMcp).toBe(true);

    await instance.adapter.sendTurn({ threadId: "t-custom", text: "go", model: "custom-deep" });
    await recorder.until((event) => event.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toEqual(["agent", "stdio", "--model", "custom-deep"]);
  });

  it("gives custom ACP only a minimal host environment while keeping MCP credentials scoped", async () => {
    const dump = join(scratch, "custom-minimal-env.json");
    process.env.BOX_TOKEN = "ambient-box-secret";
    process.env.XAI_API_KEY = "ambient-xai-secret";
    process.env.COMPOSIO_API_KEY = "ambient-composio-secret";
    process.env.EXPO_ACCESS_TOKEN = "ambient-expo-secret";
    process.env.SSH_AUTH_SOCK = "/tmp/ambient-agent.sock";
    process.env.HTTP_PROXY = "https://name:password@proxy.example";

    const config = decodeCustomAcpConfig({
      cli: FAKE_CLI,
      args: ["--cumea-test-dump", dump, "agent", "stdio"],
      versionArgs: ["--version"],
      models: { default: "default", options: [{ id: "default", label: "Default" }] },
      authFailure: "continue",
      fullAuto: false,
    });
    instance = await CustomAcpDriver.create({
      instanceId: "custom-minimal",
      displayName: "Custom minimal",
      environment: {
        BOX_TOKEN: "legacy-box-secret",
        XAI_API_KEY: "legacy-xai-secret",
        CUSTOM_SECRET: "legacy-custom-secret",
        CUMEA_BROKER_CAPABILITY: "legacy-capability",
      },
      enabled: true,
      config,
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({
      threadId: "t-custom-minimal",
      text: "go",
      integrations: {
        memory: { command: "/tmp/memory-proxy", args: [], env: { CUMEA_MEMORY_CAPABILITY: "memory-only" } },
        mcpServers: [{ name: "private", command: "/tmp/private-mcp", args: [], env: { PRIVATE_TOKEN: "mcp-only" } }],
      },
    });
    await recorder.until((event) => event.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.env.PATH).toBeTruthy();
    expect(seen.env.HOME).toBe(process.env.HOME);
    for (const key of [
      "BOX_TOKEN",
      "XAI_API_KEY",
      "COMPOSIO_API_KEY",
      "EXPO_ACCESS_TOKEN",
      "SSH_AUTH_SOCK",
      "HTTP_PROXY",
      "CUSTOM_SECRET",
      "CUMEA_BROKER_CAPABILITY",
      "CUMEA_MEMORY_CAPABILITY",
      "PRIVATE_TOKEN",
    ]) expect(seen.env[key]).toBeUndefined();
    const sessionNew = seen.calls.find((call: any) => call.method === "session/new");
    expect(sessionNew.params.mcpServers).toContainEqual({
      name: "memory",
      command: "/tmp/memory-proxy",
      args: [],
      env: [{ name: "CUMEA_MEMORY_CAPABILITY", value: "memory-only" }],
    });
    expect(sessionNew.params.mcpServers).toContainEqual({
      name: "private",
      command: "/tmp/private-mcp",
      args: [],
      env: [{ name: "PRIVATE_TOKEN", value: "mcp-only" }],
    });
  });

  it("mounts a local computer MCP server when the harness supplies one", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-computer",
      text: "inspect the screen",
      integrations: {
        localComputer: { command: "/tmp/cua-driver", args: ["mcp"], env: { CUA_TEST: "1" } },
      },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const sessionNew = seen.calls?.find((call: any) => call.method === "session/new");
    expect(sessionNew?.params?.mcpServers).toContainEqual({
      name: "computer",
      command: "/tmp/cua-driver",
      args: ["mcp"],
      env: [{ name: "CUA_TEST", value: "1" }],
    });
  });

  it("mounts only the local MCP servers assigned by the harness", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;

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
    const sessionNew = seen.calls?.find((call: any) => call.method === "session/new");
    expect(sessionNew?.params?.mcpServers).toContainEqual({
      name: "local_0123456789abcdef0123",
      command: "/tmp/private-mcp",
      args: ["--stdio"],
      env: [{ name: "PRIVATE_TOKEN", value: "secret" }],
    });
    expect(sessionNew?.params?.mcpServers).toContainEqual({
      name: "memory",
      command: "/tmp/memory-proxy",
      args: [],
      env: [{ name: "CUMEA_MEMORY_CAPABILITY", value: "opaque" }],
    });
    expect(instance.adapter.capabilities.customMcp).toBe(true);
    expect(instance.adapter.capabilities.memoryMcp).toBe(true);
  });

  it("surfaces a permission ask as request.opened and completes once allowed", async () => {
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({ threadId: "t-perm", text: "go" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({ requestType: "permission", tool: "shell" });

    await instance.adapter.respondToRequest("t-perm", (opened as any).requestId, { behavior: "allow" });
    const resolved = await recorder.until((e) => e.type === "request.resolved");
    expect(resolved).toMatchObject({ behavior: "allow", source: "user" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it("grok fails closed when the CLI advertises no cached_token (needs login)", async () => {
    await create(GrokAgentDriver, "no-auth");
    await instance.adapter.sendTurn({ threadId: "t-auth", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "auth_required" });
    const err = recorder.events.find((e) => e.type === "runtime.error")!;
    expect(err.message).toMatch(/not signed in/);
  });

  it("gemini proceeds through a missing auth method (lenient login)", async () => {
    await create(GeminiAgentDriver, "no-auth");
    await instance.adapter.sendTurn({ threadId: "t-lenient", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
    expect(recorder.events.some((e) => e.provider === "geminiAgent")).toBe(true);
  });

  it("rejects a second turn while one is in flight", async () => {
    await create(GrokAgentDriver, "hang");
    await instance.adapter.sendTurn({ threadId: "t-busy", text: "one" });
    await recorder.until((e) => e.type === "session.started");
    await expect(instance.adapter.sendTurn({ threadId: "t-busy", text: "two" })).rejects.toThrow(/already running/);
    await instance.adapter.interruptTurn("t-busy");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("interrupt settles a hung turn as cancelled", async () => {
    await create(GrokAgentDriver, "hang");
    await instance.adapter.sendTurn({ threadId: "t-int", text: "go" });
    await recorder.until((e) => e.type === "session.started");
    await instance.adapter.interruptTurn("t-int");
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ type: "turn.completed" });
  });

  it("an exit before result becomes runtime.error + failed turn", async () => {
    await create(GrokAgentDriver, "exit-early");
    await instance.adapter.sendTurn({ threadId: "t-crash", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false });
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(true);
  });

  it("redacts prompt fields before the adapter and reflected provider failures before fanout", async () => {
    const secret = "configured-secret-sentinel-987";
    process.env.FAKE_ACP_REFLECT_SECRET = secret;
    await create(GrokAgentDriver, "reflect-secret");
    const dump = join(scratch, "redaction-dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    const catalog = new SecretCatalog();
    catalog.replace([secret]);
    const bus = new EventBus(undefined, () => true, (event) => catalog.redactValue(event) as typeof event);
    bus.attach([instance]);
    const seen: unknown[] = [];
    bus.subscribe((event) => seen.push(event));

    await instance.adapter.sendTurn(catalog.redactProviderInput({
      threadId: "t-secret-egress",
      text: `typed ${secret}`,
      system: `memory ${secret}`,
      transcript: [{ role: "user", text: `legacy ${secret}` }],
    }));
    await recorder.until((event) => event.type === "turn.completed");

    const calls = JSON.stringify(JSON.parse(readFileSync(dump, "utf8")).calls);
    expect(calls).not.toContain(secret);
    expect(JSON.stringify(seen)).not.toContain(secret);
    expect(JSON.stringify(seen)).toContain("[REDACTED]");
    bus.detachAll();
  });
});

describe.skipIf(process.platform === "win32")("ACP snapshot", () => {
  it("a missing binary is unavailable", async () => {
    const instance = await GrokAgentDriver.create({
      instanceId: "grok-missing",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: "definitely-not-a-real-grok-binary", fullAuto: false },
    });
    const snap = await instance.snapshot();
    expect(snap.state).toBe("unavailable");
    await instance.dispose();
  });
});
