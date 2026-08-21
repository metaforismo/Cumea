import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { ApprovalRuleStore, deriveApprovalScope } from "./approval-rules.ts";
import { BackupService } from "./backup.ts";
import { DATA_DIR, saveConfig } from "./config.ts";
import { AgentMemoryStore } from "./memory.ts";
import { McpRegistry } from "./mcp-registry.ts";
import { PairingStore } from "./pairing.ts";
import {
  assertPersistenceWritable,
  loadPersistentJson,
  publicPersistenceIssues,
  resetPersistenceIssue,
} from "./persistence-health.ts";
import { Store } from "./store.ts";
import { WorkspaceStore } from "./workspace.ts";

const selection = () => ({ instanceId: "codex", model: "gpt-5.6-sol" });

describe("fail-closed persistence", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
  });

  it("distinguishes a missing first-run file from malformed JSON", () => {
    const file = join(DATA_DIR, "first-run.json");
    expect(loadPersistentJson(file, { label: "First run", missing: () => [], resetValue: [], validate: (value) => value as [] })).toEqual([]);
    expect(() => assertPersistenceWritable(file)).not.toThrow();

    writeFileSync(file, "{broken-secret-content");
    expect(loadPersistentJson(file, { label: "First run", missing: () => [], resetValue: [], validate: (value) => value as [] })).toEqual([]);
    expect(() => assertPersistenceWritable(file)).toThrow(/writes are blocked/);
    expect(readFileSync(file, "utf8")).toBe("{broken-secret-content");
    expect(publicPersistenceIssues()).toContainEqual(expect.objectContaining({ store: "First run", file: "first-run.json", kind: "malformed", writesBlocked: true }));
  });

  it("rejects an oversized valid JSON file before parsing or writing it", () => {
    const file = join(DATA_DIR, "oversized.json");
    const original = JSON.stringify({ value: "x".repeat(256) });
    writeFileSync(file, original);
    expect(loadPersistentJson(file, { label: "Oversized store", missing: () => ({}), resetValue: {}, maxBytes: 32, validate: (value) => value as object })).toEqual({});
    expect(publicPersistenceIssues()).toContainEqual(expect.objectContaining({ file: "oversized.json", kind: "oversized", bytes: Buffer.byteLength(original) }));
    expect(() => assertPersistenceWritable(file)).toThrow(/writes are blocked/);
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it.skipIf(process.platform === "win32")("does not follow a persistence-file symlink", () => {
    const outside = join(DATA_DIR, "outside-secret.json");
    const link = join(DATA_DIR, "linked-store.json");
    writeFileSync(outside, JSON.stringify({ secret: "outside-private-value" }));
    symlinkSync(outside, link);
    expect(loadPersistentJson(link, { label: "Linked store", missing: () => ({}), resetValue: {}, validate: (value) => value as object })).toEqual({});
    expect(publicPersistenceIssues()).toContainEqual(expect.objectContaining({ file: "linked-store.json", kind: "invalid_schema" }));
    expect(() => assertPersistenceWritable(link)).toThrow(/writes are blocked/);
    expect(readFileSync(outside, "utf8")).toContain("outside-private-value");
  });

  it.skipIf(process.platform === "win32")("treats a broken persistence symlink as invalid rather than missing", () => {
    const link = join(DATA_DIR, "broken-link.json");
    symlinkSync(join(DATA_DIR, "absent-target.json"), link);
    expect(loadPersistentJson(link, { label: "Broken link", missing: () => ({}), resetValue: {}, validate: (value) => value as object })).toEqual({});
    expect(publicPersistenceIssues()).toContainEqual(expect.objectContaining({ file: "broken-link.json", kind: "invalid_schema" }));
    expect(() => assertPersistenceWritable(link)).toThrow(/writes are blocked/);
  });

  it("preserves corrupt bytes privately before an explicit filename-confirmed reset", () => {
    const file = join(DATA_DIR, "reset-me.json");
    writeFileSync(file, "{private-corrupt-bytes");
    loadPersistentJson(file, { label: "Reset fixture", missing: () => ({}), resetValue: { version: 1, rows: [] }, validate: (value) => value as object });
    const issue = publicPersistenceIssues().find((candidate) => candidate.file === "reset-me.json")!;
    expect(() => resetPersistenceIssue(issue.id, "wrong.json")).toThrow(/type reset-me.json/);
    const result = resetPersistenceIssue(issue.id, "reset-me.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, rows: [] });
    const preserved = join(DATA_DIR, "recovery", result.preservedAs);
    expect(readFileSync(preserved, "utf8")).toBe("{private-corrupt-bytes");
    expect(statSync(preserved).mode & 0o777).toBe(0o600);
    expect(() => assertPersistenceWritable(file)).toThrow(/writes are blocked/);
    expect(publicPersistenceIssues()).toContainEqual(expect.objectContaining({ id: issue.id, recoveryPendingRestart: true }));
  });

  it("clears a stale diagnostic only after a valid restored file reloads", () => {
    const file = join(DATA_DIR, "restored.json");
    writeFileSync(file, "{broken");
    const options = {
      label: "Restored store", missing: () => [] as string[], resetValue: [],
      validate: (value: unknown) => {
        if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error("invalid restored schema");
        return value as string[];
      },
    };
    loadPersistentJson(file, options);
    expect(() => assertPersistenceWritable(file)).toThrow();
    // Models the atomic backup swap: only a subsequent strict reload clears
    // the degraded-state guard.
    writeFileSync(file, JSON.stringify(["restored"]));
    expect(loadPersistentJson(file, options)).toEqual(["restored"]);
    expect(() => assertPersistenceWritable(file)).not.toThrow();
  });

  it("blocks mutators for every corrupt security or work store instead of clobbering originals", () => {
    const malformed = "{do-not-overwrite";
    for (const name of ["config.json", "bots.json", "workspace.json", "mcp-servers.json", "mobile-devices.json", "approval-rules.json", "memory-bot-memory.json"]) {
      writeFileSync(join(DATA_DIR, name), malformed);
    }

    expect(() => saveConfig({ profile: { name: "Ada" } })).toThrow(/writes are blocked/);
    expect(() => new Store(selection).createBot()).toThrow(/writes are blocked/);
    expect(() => new WorkspaceStore().createTask({ botId: "bot", prompt: "task" })).toThrow(/writes are blocked/);
    expect(() => new WorkspaceStore().createRoutine({
      botId: "bot",
      name: "Daily check",
      prompt: "Check once",
      schedule: { kind: "interval", everyMinutes: 60 },
    })).toThrow(/writes are blocked/);
    expect(() => new McpRegistry().create({ name: "local", command: "tool" })).toThrow(/writes are blocked/);

    const pairing = new PairingStore();
    expect(() => pairing.createSession("https://host.test")).toThrow(/writes are blocked/);

    const approvals = new ApprovalRuleStore(DATA_DIR);
    expect(() => approvals.remember("bot", deriveApprovalScope("read", "read"), "deny")).toThrow(/writes are blocked/);
    expect(() => new AgentMemoryStore().create("bot-memory", { path: "facts", content: "safe" }, { source: "user" })).toThrow(/writes are blocked/);

    for (const name of ["config.json", "bots.json", "workspace.json", "mcp-servers.json", "mobile-devices.json", "approval-rules.json", "memory-bot-memory.json"]) {
      expect(readFileSync(join(DATA_DIR, name), "utf8")).toBe(malformed);
    }
  });

  it("blocks transcript appends without changing a malformed conversation file", () => {
    const initial = new Store(selection);
    const bot = initial.createBot();
    const transcript = join(DATA_DIR, `messages-${bot.threadId}.json`);
    writeFileSync(transcript, "{broken-private-transcript");

    const reloaded = new Store(selection);
    expect(reloaded.messagesFor(bot.threadId)).toEqual([]);
    expect(() => reloaded.appendMessage(bot.threadId, { role: "user", kind: "text", text: "new row" })).toThrow(/writes are blocked/);
    expect(readFileSync(transcript, "utf8")).toBe("{broken-private-transcript");
  });

  it("refuses to export a fallback snapshot when portable persistence is corrupt", async () => {
    const config = join(DATA_DIR, "config.json");
    writeFileSync(config, "{private-corrupt-config");
    await expect(new BackupService({ dataDir: DATA_DIR }).export()).rejects.toMatchObject({ status: 409 });
    expect(readFileSync(config, "utf8")).toBe("{private-corrupt-config");
  });

  it.skipIf(process.platform === "win32")("does not follow a symlink while collecting backup configuration", async () => {
    const outside = join(DATA_DIR, "outside-backup-secret.json");
    writeFileSync(outside, JSON.stringify({ xai: { key: "must-not-be-read-by-backup" } }));
    symlinkSync(outside, join(DATA_DIR, "config.json"));
    await expect(new BackupService({ dataDir: DATA_DIR }).export()).rejects.toMatchObject({ status: 409 });
    expect(readFileSync(outside, "utf8")).toContain("must-not-be-read-by-backup");
  });
});
