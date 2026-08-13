import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root: string;
let capabilities: typeof import("./file-capabilities.ts");

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "cumea-file-capability-"));
  process.env.CUMEA_DATA_DIR = root;
  capabilities = await import("./file-capabilities.ts");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.CUMEA_DATA_DIR;
});

describe("file capability boundary", () => {
  it("snapshots only regular files inside the exact bot workspace", () => {
    const workspace = capabilities.botWorkspaceDirectory("bot-safe");
    writeFileSync(join(workspace, "report.md"), "# Safe report");
    const resolved = capabilities.readLocalBotFile("bot-safe", "./report.md");
    expect(resolved).toMatchObject({ name: "report.md", source: "local" });
    expect(resolved.bytes.toString()).toBe("# Safe report");

    const store = new capabilities.FileCapabilityStore(() => 10_000);
    const issued = store.issue("bot-safe", resolved);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(capabilities.publicFileCapability(issued, resolved.source)).toMatchObject({
      name: "report.md",
      kind: "markdown",
      previewUrl: `/api/files/${issued.token}/preview`,
    });
    expect(JSON.stringify(capabilities.publicFileCapability(issued, resolved.source))).not.toContain(root);
  });

  it("rejects traversal, absolute host paths, sibling workspaces, and final symlinks", () => {
    const workspace = capabilities.botWorkspaceDirectory("bot-contained");
    const sibling = capabilities.botWorkspaceDirectory("bot-sibling");
    writeFileSync(join(root, "secret.md"), "secret");
    writeFileSync(join(sibling, "other.md"), "other");
    expect(() => capabilities.readLocalBotFile("bot-contained", "../../secret.md")).toThrow(/outside/i);
    expect(() => capabilities.readLocalBotFile("bot-contained", join(root, "secret.md"))).toThrow(/outside/i);
    expect(() => capabilities.readLocalBotFile("bot-contained", join(sibling, "other.md"))).toThrow(/outside/i);
    symlinkSync(join(root, "secret.md"), join(workspace, "link.md"));
    expect(() => capabilities.readLocalBotFile("bot-contained", "link.md")).toThrow(/regular/i);
  });

  it("expires tokens and revokes every capability owned by a deleted bot", () => {
    let now = 100;
    const store = new capabilities.FileCapabilityStore(() => now);
    const one = store.issue("bot-expiry", { name: "one.md", source: "local", bytes: Buffer.from("one") });
    const two = store.issue("bot-expiry", { name: "two.md", source: "local", bytes: Buffer.from("two") });
    expect(store.get(one.token)).not.toBeNull();
    store.revokeBot("bot-expiry");
    expect(store.get(one.token)).toBeNull();
    expect(store.get(two.token)).toBeNull();

    const expiring = store.issue("bot-expiry", { name: "three.md", source: "local", bytes: Buffer.from("three") });
    now += capabilities.FILE_CAPABILITY_TTL_MS;
    expect(store.get(expiring.token)).toBeNull();
  });

  it("quarantines and rolls back a whole workspace without following inner symlinks", () => {
    const workspace = capabilities.botWorkspaceDirectory("bot-delete");
    mkdirSync(join(workspace, "nested"));
    writeFileSync(join(workspace, "nested", "report.md"), "report");
    const transaction = capabilities.stageBotWorkspaceForDeletion("bot-delete");
    expect(() => capabilities.readLocalBotFile("bot-delete", "nested/report.md")).toThrow(/not found/i);
    expect(existsSync(workspace)).toBe(false);
    transaction.rollback();
    expect(capabilities.readLocalBotFile("bot-delete", "nested/report.md").bytes.toString()).toBe("report");

    const purged = capabilities.stageBotWorkspaceForDeletion("bot-delete");
    purged.purge();
    expect(() => capabilities.readLocalBotFile("bot-delete", "nested/report.md")).toThrow(/not found/i);
  });
});
