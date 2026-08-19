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
  it("snapshots regular files only inside the exact bot workspace without projecting a host path", () => {
    const workspace = capabilities.botWorkspaceDirectory("bot-safe");
    writeFileSync(join(workspace, "report.md"), "# Safe report");

    const resolved = capabilities.readLocalBotFile("bot-safe", "./report.md");
    expect(resolved).toMatchObject({ name: "report.md", source: "local" });
    expect(resolved.bytes.toString()).toBe("# Safe report");

    const store = new capabilities.FileCapabilityStore(() => 10_000);
    const issued = store.issue("bot-safe", resolved);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(capabilities.publicFileCapability(issued)).toMatchObject({
      name: "report.md",
      kind: "markdown",
      source: "local",
      previewUrl: `/api/files/${issued.token}/preview`,
      downloadUrl: `/api/files/${issued.token}/download`,
    });
    expect(JSON.stringify(capabilities.publicFileCapability(issued))).not.toContain(root);
  });

  it("rejects traversal, absolute host paths, and sibling workspaces", () => {
    capabilities.botWorkspaceDirectory("bot-contained");
    const sibling = capabilities.botWorkspaceDirectory("bot-sibling");
    writeFileSync(join(root, "secret.md"), "secret");
    writeFileSync(join(sibling, "other.md"), "other");

    expect(() => capabilities.readLocalBotFile("bot-contained", "../../secret.md")).toThrow(/outside/i);
    expect(() => capabilities.readLocalBotFile("bot-contained", join(root, "secret.md"))).toThrow(/outside/i);
    expect(() => capabilities.readLocalBotFile("bot-contained", join(sibling, "other.md"))).toThrow(/outside/i);
  });

  it.runIf(process.platform !== "win32")("rejects a final symlink even when it points to a regular file", () => {
    const workspace = capabilities.botWorkspaceDirectory("bot-symlink");
    const outside = join(root, "outside.md");
    writeFileSync(outside, "secret");
    symlinkSync(outside, join(workspace, "link.md"));
    expect(() => capabilities.readLocalBotFile("bot-symlink", "link.md")).toThrow(/regular/i);
  });

  it("validates signatures for previewable formats and keeps unknown files download-only", () => {
    const store = new capabilities.FileCapabilityStore(() => 1);
    const markdown = store.issue("bot-types", {
      name: "report.md",
      source: "local",
      bytes: Buffer.from("# report"),
    });
    expect(markdown.kind).toBe("markdown");
    expect(markdown.mime).toMatch(/^text\/markdown/);

    const pdf = store.issue("bot-types", {
      name: "report.pdf",
      source: "local",
      bytes: Buffer.from("%PDF-1.7\n1 0 obj\n%%EOF"),
    });
    expect(pdf.kind).toBe("pdf");

    expect(() => store.issue("bot-types", {
      name: "fake.pdf",
      source: "local",
      bytes: Buffer.from("<script>alert(1)</script>%%EOF"),
    })).toThrow(/signature/i);

    const binary = store.issue("bot-types", {
      name: "archive.bin",
      source: "local",
      bytes: Buffer.from([1, 2, 3]),
    });
    expect(binary).toMatchObject({ kind: "binary", mime: "application/octet-stream" });
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

  it("evicts old capabilities before exceeding the bounded in-memory set", () => {
    const store = new capabilities.FileCapabilityStore(() => 1);
    const first = store.issue("bot-budget", { name: "first.md", source: "local", bytes: Buffer.from("first") });
    for (let index = 0; index < 64; index += 1) {
      store.issue("bot-budget", {
        name: `${index}.md`,
        source: "local",
        bytes: Buffer.from(`value-${index}`),
      });
    }
    expect(store.get(first.token)).toBeNull();
  });

  it("quarantines and rolls back a whole workspace before irreversible deletion", () => {
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
