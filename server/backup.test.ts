import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_MAX_FILE_BYTES,
  BackupService,
  CUMEA_DATA_SCHEMA_VERSION,
  type BackupManifest,
} from "./backup.ts";
import { SkillRegistry } from "./skill-registry.ts";

const roots: string[] = [];

function portableBot(patch: Record<string, unknown> = {}) {
  return {
    id: "bot-a",
    threadId: "thread-a",
    name: "Ada",
    title: "Research assistant",
    description: "Helps with research",
    notifications: true,
    color: "orange",
    avatar: { kind: "mote", shapeId: "drop", color: "#f56a16", motion: "playful" },
    unread: false,
    modelSelection: { instanceId: "provider-a", model: "model-a" },
    resumeCursors: {},
    memoryWriteEnabled: false,
    busy: false,
    createdAt: 1,
    ...patch,
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cumea-backup-test-"));
  roots.push(root);
  const dataDir = join(root, ".cumea");
  mkdirSync(join(dataDir, "attachments", "bot-a"), { recursive: true });
  mkdirSync(join(dataDir, "bot-workspaces", "bot-a", "notes"), { recursive: true });
  const attachmentPath = join(dataDir, "attachments", "bot-a", "source.bin");
  writeFileSync(attachmentPath, "attachment bytes");
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({
    xai: { key: "sk-secret-that-must-never-export-123456" },
    profile: { name: "Ada", email: "ada@example.test" },
  }));
  writeFileSync(join(dataDir, "mcp-servers.json"), JSON.stringify({
    servers: [{ environment: { API_TOKEN: "mcp-secret-that-must-never-export" } }],
  }));
  writeFileSync(join(dataDir, "mobile-devices.json"), JSON.stringify({
    devices: [{ tokenHash: "hash", push: { token: "ExpoPushToken[private-push-value]" } }],
  }));
  writeFileSync(join(dataDir, "bots.json"), JSON.stringify([portableBot({
    sectionId: "section-a",
    busy: true,
    resumeCursors: { provider: "provider-session-secret" },
    mcpServerIds: ["mcp-abc"],
  })]));
  writeFileSync(join(dataDir, "messages-thread-a.json"), JSON.stringify({
    messages: [{ id: "message-a", role: "user", kind: "text", text: "sk-secret-that-must-never-export-123456", at: 1 }],
    activeLeafId: "message-a",
  }));
  writeFileSync(join(dataDir, "memory-bot-a.json"), JSON.stringify({ version: 1, botId: "bot-a", documents: [] }));
  writeFileSync(join(dataDir, "workspace.json"), JSON.stringify({
    sections: [{ id: "section-a", name: "Team", createdAt: 1 }],
    attachments: [{ id: "attachment-a", botId: "bot-a", threadId: "thread-a", name: "file.txt", mime: "text/plain", size: 16, storedPath: attachmentPath, createdAt: 1 }],
    tasks: [{ id: "task-a", botId: "bot-a", title: "Hello", prompt: "hello", source: "message", status: "completed", attachmentIds: [], latestRunId: "run-a", evidenceRequirements: [{ id: "requirement-a", label: "Canonical output exists", createdAt: 1 }], createdAt: 1, updatedAt: 1 }],
    runs: [{ id: "run-a", taskId: "task-a", botId: "bot-a", status: "completed", steps: [{ id: "step-a", kind: "tool", title: "Build", status: "completed", startedAt: 1, completedAt: 2 }], artifacts: [], evidence: [{ id: "evidence-a", requirementId: "requirement-a", level: "observed", source: "user", label: "Build", reference: { kind: "step", id: "step-a", runId: "run-a" }, digest: `sha256:${"a".repeat(64)}`, recordedAt: 2 }], effects: [{ id: "effect-a", runId: "run-a", taskId: "task-a", botId: "bot-a", stepId: "step-a", origin: "controlled", descriptor: { boundary: "calendar.create", action: "create" }, requestHash: `sha256:${"b".repeat(64)}`, idempotencyKey: `sha256:${"c".repeat(64)}`, fingerprint: `sha256:${"d".repeat(64)}`, attempt: 1, state: "applied", result: { ok: true, kind: "object", reference: "remote-a", digest: `sha256:${"e".repeat(64)}` }, audit: [{ id: "effect-audit-a", event: "intended", at: 1 }, { id: "effect-audit-b", event: "applying", at: 1 }, { id: "effect-audit-c", event: "applied", at: 2 }], createdAt: 1, updatedAt: 2 }], startedAt: 1, completedAt: 2 }],
    routines: [{ id: "routine-a", botId: "bot-a", name: "Daily", prompt: "go", schedule: { kind: "daily", time: "09:00", timezone: "UTC" }, enabled: false, nextRunAt: null, createdAt: 1, updatedAt: 1 }],
  }));
  writeFileSync(join(dataDir, "bot-workspaces", "bot-a", "notes", "result.txt"), "safe result");
  writeFileSync(join(dataDir, "bot-workspaces", "bot-a", "session-token.txt"), "private");
  writeFileSync(join(dataDir, "bot-workspaces", "bot-a", "looks-safe.txt"), "mcp-secret-that-must-never-export");
  return { root, dataDir, service: new BackupService({ dataDir, now: () => Date.UTC(2026, 7, 14) }) };
}

async function minimalArchive(overrides: Partial<BackupManifest> = {}, payload: Record<string, Buffer | string> = {}) {
  const files = Object.entries(payload).map(([path, value]) => {
    const bytes = Buffer.from(value);
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    dataSchemaVersion: CUMEA_DATA_SCHEMA_VERSION,
    createdAt: new Date(0).toISOString(),
    scope: { kind: "full", botIds: [] },
    files,
    exclusions: [],
    skippedWorkspaceFiles: 0,
    ...overrides,
  };
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest));
  for (const [path, value] of Object.entries(payload)) zip.file(path, value);
  return zip.generateAsync({ type: "nodebuffer" });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BackupService", () => {
  it("exports an integrity-inventoried archive while excluding host credentials and provider sessions", async () => {
    const { service } = fixture();
    const exported = await service.export();
    const raw = exported.bytes.toString("latin1");
    expect(raw).not.toContain("sk-secret-that-must-never-export-123456");
    expect(raw).not.toContain("mcp-secret-that-must-never-export");
    expect(raw).not.toContain("private-push-value");

    const inspected = await service.inspect(exported.bytes);
    expect(inspected.inspection).toMatchObject({ botCount: 1, attachmentCount: 1 });
    expect(inspected.inspection.warnings).toHaveLength(1);
    expect(inspected.files.has("payload/workspaces/bot-a/notes/result.txt")).toBe(true);
    expect(inspected.files.has("payload/workspaces/bot-a/session-token.txt")).toBe(false);
    expect(inspected.files.has("payload/workspaces/bot-a/looks-safe.txt")).toBe(false);
    expect([...inspected.files.keys()].some((path) => path.includes("approval-rules"))).toBe(false);
    expect(inspected.bots[0]).toMatchObject({ busy: false, resumeCursors: {} });
    expect(inspected.bots[0]).toMatchObject({ memoryWriteEnabled: false });
    expect(inspected.bots[0]).not.toHaveProperty("approvalPolicy");
    expect(inspected.bots[0]).not.toHaveProperty("mcpServerIds");
    expect(inspected.workspace.runs[0].effects).toEqual([expect.objectContaining({ state: "applied", requestHash: `sha256:${"b".repeat(64)}` })]);
    expect(JSON.stringify(inspected.workspace.runs[0].effects)).not.toContain("requestBody");
    expect(inspected.files.get("payload/messages/thread-a.json")!.toString()).toContain("[REDACTED]");
  });

  it("fails closed instead of exporting forged external-effect request data", async () => {
    const { dataDir, service } = fixture();
    const path = join(dataDir, "workspace.json");
    const workspace = JSON.parse(readFileSync(path, "utf8"));
    workspace.runs[0].effects[0].rawRequest = { accessToken: "must-not-travel" };
    writeFileSync(path, JSON.stringify(workspace));

    await expect(service.export()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("cannot be represented") });
  });

  it("round-trips bounded compaction statistics and rejects hostile schema", async () => {
    const { dataDir, service } = fixture();
    const path = join(dataDir, "workspace.json");
    const workspace = JSON.parse(readFileSync(path, "utf8"));
    workspace.runs[0].compaction = { policyVersion: 1, compacted: true, originalMessages: 50, submittedMessages: 20, originalBytes: 100_000, submittedBytes: 60_000, omittedMessages: 30, estimatedSubmittedTokens: 15_000, selectedIdentityDigest: `sha256:${"f".repeat(64)}` };
    writeFileSync(path, JSON.stringify(workspace));
    const inspected = await service.inspect((await service.export()).bytes);
    expect(inspected.workspace.runs[0].compaction).toMatchObject({ compacted: true, omittedMessages: 30 });

    workspace.runs[0].compaction.rawHistory = "must not travel";
    writeFileSync(path, JSON.stringify(workspace));
    await expect(service.export()).rejects.toMatchObject({ status: 409 });
  });

  it("ports only bounded checkpoint metadata and rejects raw provider cursor fields", async () => {
    const { dataDir, service } = fixture();
    const path = join(dataDir, "workspace.json");
    const workspace = JSON.parse(readFileSync(path, "utf8"));
    workspace.tasks[0].status = "interrupted";
    workspace.tasks[0].messageId = "message-a";
    workspace.runs[0].status = "interrupted";
    workspace.runs[0].resumeStatus = "available";
    workspace.runs[0].attempt = 1;
    workspace.runs[0].checkpoint = {
      version: 1,
      id: "checkpoint-a",
      runId: "run-a",
      taskId: "task-a",
      botId: "bot-a",
      phase: "provider",
      status: "available",
      activeLeafId: "message-a",
      provider: { instanceId: "provider-a", model: "model-a" },
      cursor: { instanceId: "provider-a", digest: `sha256:${"f".repeat(64)}` },
      sequence: 2,
      createdAt: 1,
      updatedAt: 2,
    };
    writeFileSync(path, JSON.stringify(workspace));

    const inspected = await service.inspect((await service.export()).bytes);
    expect(inspected.workspace.runs[0].checkpoint).toMatchObject({ status: "available", cursor: { digest: `sha256:${"f".repeat(64)}` } });
    expect(JSON.stringify(inspected.workspace)).not.toContain("raw-provider-cursor");

    workspace.runs[0].checkpoint.cursor.raw = "raw-provider-cursor";
    writeFileSync(path, JSON.stringify(workspace));
    await expect(service.export()).rejects.toMatchObject({ status: 409 });
  });

  it("scans complete large binary workspace files for known credentials", async () => {
    const { dataDir, service } = fixture();
    const bytes = Buffer.alloc(3 * 1024 * 1024, 0);
    Buffer.from("mcp-secret-that-must-never-export").copy(bytes, bytes.length - 64);
    writeFileSync(join(dataDir, "bot-workspaces", "bot-a", "large-output.bin"), bytes);
    const inspected = await service.inspect((await service.export()).bytes);
    expect(inspected.files.has("payload/workspaces/bot-a/large-output.bin")).toBe(false);
    expect(inspected.inspection.manifest.skippedWorkspaceFiles).toBeGreaterThanOrEqual(3);
  });

  it("round-trips the canonical offline model selection without requiring a live provider", async () => {
    const { dataDir, service } = fixture();
    const bots = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"));
    bots[0].modelSelection = { instanceId: "", model: "" };
    writeFileSync(join(dataDir, "bots.json"), JSON.stringify(bots));
    const inspected = await service.inspect((await service.export()).bytes);
    expect(inspected.bots[0].modelSelection).toEqual({ instanceId: "", model: "" });
  });

  it("rejects attachment metadata that points outside managed per-agent storage", async () => {
    const { root, dataDir, service } = fixture();
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "attachment bytes");
    const workspace = JSON.parse(readFileSync(join(dataDir, "workspace.json"), "utf8"));
    workspace.attachments[0].storedPath = outside;
    writeFileSync(join(dataDir, "workspace.json"), JSON.stringify(workspace));
    await expect(service.export()).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ["config.json", "configuration secret registry"],
    ["mcp-servers.json", "MCP secret registry"],
    ["mobile-devices.json", "paired-device secret registry"],
  ])("fails closed when existing %s secret data is malformed", async (file, message) => {
    const { dataDir, service } = fixture();
    writeFileSync(join(dataDir, file), "{broken");
    await expect(service.export()).rejects.toMatchObject({ status: 409, message: expect.stringContaining(message) });
  });

  it("refuses a syntactically valid workspace that contains a malformed core row", async () => {
    const { dataDir, service } = fixture();
    const workspace = JSON.parse(readFileSync(join(dataDir, "workspace.json"), "utf8"));
    workspace.tasks.push(null);
    writeFileSync(join(dataDir, "workspace.json"), JSON.stringify(workspace));
    await expect(service.export()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("tasks") });
  });

  it("does not follow workspace symlinks outside the managed root", async () => {
    const { root, dataDir, service } = fixture();
    const outside = join(root, "outside-workspace.txt");
    writeFileSync(outside, "outside");
    symlinkSync(outside, join(dataDir, "bot-workspaces", "bot-a", "outside-link.txt"));
    const inspected = await service.inspect((await service.export()).bytes);
    expect(inspected.files.has("payload/workspaces/bot-a/outside-link.txt")).toBe(false);
  });

  it.each([
    ["bots.json", "agent roster"],
    ["workspace.json", "workspace database"],
    ["messages-thread-a.json", "transcript"],
  ])("refuses to turn malformed core %s data into an empty backup", async (file, message) => {
    const { dataDir, service } = fixture();
    writeFileSync(join(dataDir, file), "{broken");
    await expect(service.export()).rejects.toMatchObject({ status: 409, message: expect.stringContaining(message) });
  });

  it("refuses to export syntactically valid data that its restore boundary cannot consume", async () => {
    const { dataDir, service } = fixture();
    writeFileSync(join(dataDir, "messages-thread-a.json"), JSON.stringify({
      messages: [{ id: "message-a", role: "user", kind: "unknown", at: 1 }],
      activeLeafId: "message-a",
    }));
    await expect(service.export()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("portable backup"),
    });
  });

  it("supports selective per-agent exports", async () => {
    const { service } = fixture();
    const exported = await service.export({ kind: "agent", botId: "bot-a" });
    const inspected = await service.inspect(exported.bytes);
    expect(inspected.inspection.manifest.scope).toEqual({ kind: "agent", botIds: ["bot-a"] });
    expect(inspected.workspace.sections).toEqual([{ id: "section-a", name: "Team", createdAt: 1 }]);
    await expect(service.export({ kind: "agent", botId: "missing" })).rejects.toMatchObject({ status: 404 });
  });

  it("selectively restores one agent without replacing unrelated agents or their runtime logs", async () => {
    const { dataDir, service } = fixture();
    const archive = (await service.export({ kind: "agent", botId: "bot-a" })).bytes;
    const bots = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"));
    bots[0].name = "Changed after export";
    bots.push(portableBot({ id: "bot-b", threadId: "thread-b", name: "Bob", approvalPolicy: "ask" }));
    writeFileSync(join(dataDir, "bots.json"), JSON.stringify(bots));
    writeFileSync(join(dataDir, "messages-thread-b.json"), JSON.stringify({ messages: [], activeLeafId: null }));
    const workspace = JSON.parse(readFileSync(join(dataDir, "workspace.json"), "utf8"));
    workspace.tasks.push({ id: "task-b", botId: "bot-b", title: "Keep", prompt: "keep", source: "message", status: "completed", attachmentIds: [], createdAt: 1, updatedAt: 1 });
    writeFileSync(join(dataDir, "workspace.json"), JSON.stringify(workspace));
    mkdirSync(join(dataDir, "events"), { recursive: true });
    mkdirSync(join(dataDir, "native"), { recursive: true });
    writeFileSync(join(dataDir, "events", "thread-a.ndjson"), "stale a");
    writeFileSync(join(dataDir, "events", "thread-b.ndjson"), "keep b");
    writeFileSync(join(dataDir, "approval-rules.json"), JSON.stringify({ version: 1, rules: [
      { id: "rule-a", botId: "bot-a" },
      { id: "rule-b", botId: "bot-b" },
    ] }));

    await service.restore(archive);

    expect(JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8")).map((bot: { id: string; name: string }) => [bot.id, bot.name])).toEqual([
      ["bot-b", "Bob"],
      ["bot-a", "Ada"],
    ]);
    expect(JSON.parse(readFileSync(join(dataDir, "workspace.json"), "utf8")).tasks.map((task: { id: string }) => task.id).sort()).toEqual(["task-a", "task-b"]);
    expect(readdirSync(join(dataDir, "events"))).toEqual(["thread-b.ndjson"]);
    expect(JSON.parse(readFileSync(join(dataDir, "approval-rules.json"), "utf8")).rules).toEqual([{ id: "rule-b", botId: "bot-b" }]);
  });

  it("rejects corrupt, missing, traversing, oversized and newer-schema archives", async () => {
    const { service } = fixture();
    const exported = await service.export();
    const corrupt = Buffer.from(exported.bytes);
    corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
    await expect(service.inspect(corrupt)).rejects.toMatchObject({ status: 400 });

    const missing = await minimalArchive({}, {
      "payload/bots.json": "[]",
      "payload/workspace.json": JSON.stringify({ sections: [], attachments: [], tasks: [], runs: [], routines: [] }),
    });
    const missingZip = await JSZip.loadAsync(missing);
    missingZip.remove("payload/workspace.json");
    await expect(service.inspect(await missingZip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ status: 400 });

    const traversalZip = new JSZip();
    traversalZip.file("../evil", "x");
    traversalZip.file("manifest.json", "{}");
    await expect(service.inspect(await traversalZip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ status: 400 });

    const oversized = await minimalArchive({ files: [{ path: "payload/too-big", bytes: BACKUP_MAX_FILE_BYTES + 1, sha256: "0".repeat(64) }] });
    await expect(service.inspect(oversized)).rejects.toMatchObject({ status: 400 });

    const newer = await minimalArchive({ dataSchemaVersion: CUMEA_DATA_SCHEMA_VERSION + 1 } as unknown as Partial<BackupManifest>);
    await expect(service.inspect(newer)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects crafted portable authority and invalid scheduler data before restore", async () => {
    const bot = portableBot();
    const baseWorkspace = { sections: [], attachments: [], tasks: [], runs: [], routines: [] };
    const payload = {
      "payload/bots.json": JSON.stringify([bot]),
      "payload/workspace.json": JSON.stringify(baseWorkspace),
      "payload/messages/thread-a.json": JSON.stringify({ messages: [], activeLeafId: null }),
    };
    const authority = await minimalArchive({ scope: { kind: "agent", botIds: ["bot-a"] } }, {
      ...payload,
      "payload/bots.json": JSON.stringify([{ ...bot, approvalPolicy: "allow" }]),
    });
    const { service } = fixture();
    await expect(service.inspect(authority)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("authority") });

    const invalidRoutine = await minimalArchive({ scope: { kind: "agent", botIds: ["bot-a"] } }, {
      ...payload,
      "payload/workspace.json": JSON.stringify({
        ...baseWorkspace,
        routines: [{ id: "routine-a", botId: "bot-a", name: "Broken", prompt: "go", enabled: true, nextRunAt: 1, createdAt: 1, updatedAt: 1, schedule: { kind: "daily", time: "99:99", timezone: "UTC" } }],
      }),
    });
    await expect(service.inspect(invalidRoutine)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("schedule") });

    const invalidBudget = await minimalArchive({ scope: { kind: "agent", botIds: ["bot-a"] } }, {
      ...payload,
      "payload/workspace.json": JSON.stringify({
        ...baseWorkspace,
        tasks: [{ id: "task-a", botId: "bot-a", title: "Bad budget", prompt: "go", source: "message", status: "completed", attachmentIds: [], budget: { toolCalls: "2" }, createdAt: 1, updatedAt: 1 }],
        runs: [{ id: "run-a", taskId: "task-a", botId: "bot-a", status: "completed", steps: [], artifacts: [], budgetUsage: { startedAt: 1, toolCalls: -1, computerActions: 0, delegations: 0 }, startedAt: 1, completedAt: 2 }],
      }),
    });
    await expect(service.inspect(invalidBudget)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("budget") });

    const invalidUsageWorkspace = {
      ...baseWorkspace,
      tasks: [{ id: "task-a", botId: "bot-a", title: "Budget", prompt: "go", source: "message", status: "completed", attachmentIds: [], budget: { tokens: 100 }, createdAt: 1, updatedAt: 1 }],
      runs: [{ id: "run-a", taskId: "task-a", botId: "bot-a", status: "completed", steps: [], artifacts: [], budgetUsage: { startedAt: 1, durationUsedMs: 0, toolCalls: 0, computerActions: 0, delegations: 0, tokenBaseline: { input: 1, output: 2, secret: 3 }, exhaustionReason: "tokens" }, startedAt: 1, completedAt: 2 }],
    };
    const invalidUsage = await minimalArchive({ scope: { kind: "agent", botIds: ["bot-a"] } }, { ...payload, "payload/workspace.json": JSON.stringify(invalidUsageWorkspace) });
    await expect(service.inspect(invalidUsage)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("budget") });

    const missingUsage = await minimalArchive({ scope: { kind: "agent", botIds: ["bot-a"] } }, {
      ...payload,
      "payload/workspace.json": JSON.stringify({
        ...baseWorkspace,
        tasks: [{ id: "task-a", botId: "bot-a", title: "Budget", prompt: "go", source: "message", status: "completed", attachmentIds: [], budget: { toolCalls: 1 }, createdAt: 1, updatedAt: 1 }],
        runs: [{ id: "run-a", taskId: "task-a", botId: "bot-a", status: "completed", steps: [], artifacts: [], startedAt: 1, completedAt: 2 }],
      }),
    });
    await expect(service.inspect(missingUsage)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("budget linkage") });

    const unconfiguredExhaustion = await minimalArchive({ scope: { kind: "agent", botIds: ["bot-a"] } }, {
      ...payload,
      "payload/workspace.json": JSON.stringify({
        ...baseWorkspace,
        tasks: [{ id: "task-a", botId: "bot-a", title: "Budget", prompt: "go", source: "message", status: "completed", attachmentIds: [], budget: { toolCalls: 1 }, createdAt: 1, updatedAt: 1 }],
        runs: [{ id: "run-a", taskId: "task-a", botId: "bot-a", status: "completed", steps: [], artifacts: [], budgetUsage: { startedAt: 1, durationUsedMs: 0, toolCalls: 1, computerActions: 0, delegations: 0, exhaustionReason: "tokens", exhaustedAt: 2 }, startedAt: 1, completedAt: 2 }],
      }),
    });
    await expect(service.inspect(unconfiguredExhaustion)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("unconfigured") });
  });

  it("rejects malformed runtime records, sections, transcripts, and memories before swap", async () => {
    const { service } = fixture();
    const workspace = { sections: [], attachments: [], tasks: [], runs: [], routines: [] };
    const scope = { kind: "agent" as const, botIds: ["bot-a"] };
    const archive = (overrides: Record<string, string>) => minimalArchive({ scope }, {
      "payload/bots.json": JSON.stringify([portableBot()]),
      "payload/workspace.json": JSON.stringify(workspace),
      "payload/messages/thread-a.json": JSON.stringify({ messages: [], activeLeafId: null }),
      ...overrides,
    });

    await expect(service.inspect(await archive({
      "payload/bots.json": JSON.stringify([portableBot({ modelSelection: { instanceId: 42, model: "x" } })]),
    }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("provider") });

    await expect(service.inspect(await archive({
      "payload/bots.json": JSON.stringify([portableBot({ lifecycle: { kind: "temporary", expiresAt: "soon" } })]),
    }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("lifecycle") });

    await expect(service.inspect(await archive({
      "payload/workspace.json": JSON.stringify({ ...workspace, sections: [{ id: "section-a", name: "x".repeat(501), createdAt: 1 }] }),
    }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("section name") });

    await expect(service.inspect(await archive({
      "payload/messages/thread-a.json": JSON.stringify({ messages: [{ id: "m", role: "user", kind: "text", text: "hello", at: Number.MAX_SAFE_INTEGER + 1 }], activeLeafId: "m" }),
    }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("number") });

    await expect(service.inspect(await archive({
      "payload/messages/thread-a.json": JSON.stringify({ messages: new Array(50_001).fill({ id: "m", role: "user", kind: "text", at: 1 }), activeLeafId: null }),
    }))).rejects.toMatchObject({ status: 400 });

    await expect(service.inspect(await archive({
      "payload/memory/bot-a.json": JSON.stringify({ version: 1, botId: "bot-a", documents: [{ id: "doc", path: "notes.md", pinned: false, createdAt: 1, updatedAt: 1, revisions: [] }] }),
    }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("revisions") });
  });

  it("dry-runs without writes, restores atomically, retains local secrets, and keeps a pre-restore backup", async () => {
    const { dataDir, service } = fixture();
    mkdirSync(join(dataDir, "events"), { recursive: true });
    mkdirSync(join(dataDir, "native"), { recursive: true });
    writeFileSync(join(dataDir, "events", "thread-a.ndjson"), "stale event\n");
    writeFileSync(join(dataDir, "native", "thread-a.ndjson"), "stale provider session\n");
    writeFileSync(join(dataDir, "approval-rules.json"), JSON.stringify({ version: 1, rules: [{ id: "rule-a", botId: "bot-a" }] }));
    const exported = await service.export();
    writeFileSync(join(dataDir, "bots.json"), "[]");
    const beforeDryRun = readFileSync(join(dataDir, "bots.json"), "utf8");
    expect((await service.restore(exported.bytes, { dryRun: true })).dryRun).toBe(true);
    expect(readFileSync(join(dataDir, "bots.json"), "utf8")).toBe(beforeDryRun);

    let reloads = 0;
    const result = await service.restore(exported.bytes, { reload: () => { reloads += 1; } });
    expect(result.dryRun).toBe(false);
    expect(result.preRestoreBackup).toBeTruthy();
    expect(reloads).toBe(1);
    expect(JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"))).toHaveLength(1);
    expect(readFileSync(join(dataDir, "config.json"), "utf8")).toContain("sk-secret-that-must-never-export-123456");
    expect(readFileSync(join(dataDir, "attachments", "bot-a", "attachment-a"), "utf8")).toBe("attachment bytes");
    expect(readdirSync(join(dataDir, "events"))).toEqual([]);
    expect(readdirSync(join(dataDir, "native"))).toEqual([]);
    expect(JSON.parse(readFileSync(join(dataDir, "approval-rules.json"), "utf8")).rules).toEqual([]);
  });

  it("round-trips full local skill packages and rejects inner digest tampering", async () => {
    const { dataDir, service } = fixture();
    const skills = new SkillRegistry(dataDir);
    const skill = skills.create({ id: "release-check", displayName: "Release check", description: "Review evidence", version: "1.0.0", instructions: "Check exact evidence.", label: "Local editor", enabled: true }, { now: 10 });
    const bots = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"));
    bots[0].skillAssignments = [{ id: "release-check", version: "1.0.0" }];
    writeFileSync(join(dataDir, "bots.json"), JSON.stringify(bots));
    const exported = await service.export();
    expect((await service.inspect(exported.bytes)).inspection.manifest.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "payload/skills/release-check/1.0.0/manifest.json",
      "payload/skills/release-check/1.0.0/instructions.md",
    ]));

    const payload = {
      "payload/bots.json": JSON.stringify([portableBot({ skillAssignments: [{ id: "release-check", version: "1.0.0" }] })]),
      "payload/workspace.json": JSON.stringify({ sections: [], attachments: [], tasks: [], runs: [], routines: [] }),
      "payload/messages/thread-a.json": JSON.stringify({ messages: [], activeLeafId: null }),
      "payload/skills/release-check/1.0.0/manifest.json": JSON.stringify({ ...skill.manifest, contentSha256: `sha256:${"0".repeat(64)}` }),
      "payload/skills/release-check/1.0.0/instructions.md": skill.instructions,
    };
    await expect(service.inspect(await minimalArchive({ scope: { kind: "full", botIds: ["bot-a"] } }, payload))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("digest") });
  });

  it("rejects skill package path traversal before expansion", async () => {
    const { service } = fixture();
    const archive = await minimalArchive({}, { "payload/skills/../escape/instructions.md": "no" });
    await expect(service.inspect(archive)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("unsafe path") });
  });

  it("refuses to export credential-like local skill content", async () => {
    const { dataDir, service } = fixture();
    new SkillRegistry(dataDir).create({ id: "unsafe-secret", displayName: "Unsafe", description: "", version: "1.0.0", instructions: "Use sk-secret-that-must-never-export-123456", label: "Local editor", enabled: true });
    await expect(service.export()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("credential-like") });
  });

  it.each(["before-swap", "after-old-rename", "after-new-rename"] as const)("rolls back an injected %s failure", async (failureInjection) => {
    const { dataDir, service } = fixture();
    const exported = await service.export();
    writeFileSync(join(dataDir, "sentinel.txt"), "original");
    await expect(service.restore(exported.bytes, { failureInjection })).rejects.toMatchObject({ status: 500 });
    expect(readFileSync(join(dataDir, "sentinel.txt"), "utf8")).toBe("original");
  });
});
