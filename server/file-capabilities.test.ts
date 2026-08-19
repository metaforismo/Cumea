import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BOT_WORKSPACES_DIR, DATA_DIR } from "./config.ts";
import {
  FILE_CAPABILITY_TTL_MS,
  FileCapabilityStore,
  botWorkspaceDirectory,
  publicFileCapability,
  readLocalBotFile,
  stageBotWorkspaceForDeletion,
} from "./file-capabilities.ts";

const ids = ["cap-safe", "cap-contained", "cap-sibling", "cap-expiry", "cap-delete", "cap-root-swap"];

afterEach(() => {
  for (const id of ids) rmSync(join(BOT_WORKSPACES_DIR, id), { recursive: true, force: true });
  rmSync(join(DATA_DIR, "secret.md"), { force: true });
});

describe("file capability boundary", () => {
  it("snapshots only regular files inside the exact bot workspace without exposing a host path", () => {
    const workspace = botWorkspaceDirectory("cap-safe");
    writeFileSync(join(workspace, "report.md"), "# Safe report");
    const resolved = readLocalBotFile("cap-safe", "./report.md");
    expect(resolved).toMatchObject({ name: "report.md", source: "workspace" });
    expect(resolved.bytes.toString()).toBe("# Safe report");

    const store = new FileCapabilityStore(() => 10_000);
    const issued = store.issue("cap-safe", resolved);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const publicValue = publicFileCapability(issued);
    expect(publicValue).toMatchObject({
      name: "report.md",
      kind: "markdown",
      source: "workspace",
      previewUrl: `/api/files/${issued.token}/preview`,
    });
    expect(JSON.stringify(publicValue)).not.toContain(DATA_DIR);
  });

  it("rejects traversal, absolute paths, sibling workspaces, URLs, and final symlinks", () => {
    const workspace = botWorkspaceDirectory("cap-contained");
    const sibling = botWorkspaceDirectory("cap-sibling");
    const outside = join(DATA_DIR, "secret.md");
    writeFileSync(outside, "secret");
    writeFileSync(join(sibling, "other.md"), "other");

    expect(() => readLocalBotFile("cap-contained", "../../secret.md")).toThrow(/outside/i);
    expect(() => readLocalBotFile("cap-contained", outside)).toThrow(/relative/i);
    expect(() => readLocalBotFile("cap-contained", "https://example.test/report.md")).toThrow(/relative/i);
    expect(() => readLocalBotFile("cap-contained", "C:\\secret.md")).toThrow(/relative/i);
    symlinkSync(outside, join(workspace, "link.md"));
    expect(() => readLocalBotFile("cap-contained", "link.md")).toThrow(/regular/i);
  });

  it("fails closed when the bot workspace directory itself is replaced by a symlink", () => {
    const sibling = botWorkspaceDirectory("cap-sibling");
    writeFileSync(join(sibling, "other.md"), "other bot data");
    const workspace = botWorkspaceDirectory("cap-root-swap");
    rmSync(workspace, { recursive: true, force: true });
    symlinkSync(sibling, workspace, "dir");

    expect(() => botWorkspaceDirectory("cap-root-swap")).toThrow(/safe directory/i);
    expect(() => readLocalBotFile("cap-root-swap", "other.md")).toThrow(/safe directory/i);
  });

  it("expires tokens and revokes every capability owned by a deleted bot", () => {
    let now = 100;
    const store = new FileCapabilityStore(() => now);
    const one = store.issue("cap-expiry", { name: "one.md", source: "workspace", bytes: Buffer.from("one") });
    const two = store.issue("cap-expiry", { name: "two.md", source: "workspace", bytes: Buffer.from("two") });
    expect(store.get(one.token)).not.toBeNull();
    store.revokeBot("cap-expiry");
    expect(store.get(one.token)).toBeNull();
    expect(store.get(two.token)).toBeNull();

    const expiring = store.issue("cap-expiry", { name: "three.md", source: "workspace", bytes: Buffer.from("three") });
    now += FILE_CAPABILITY_TTL_MS;
    expect(store.get(expiring.token)).toBeNull();
  });

  it("quarantines and rolls back a whole workspace without following inner symlinks", () => {
    const workspace = botWorkspaceDirectory("cap-delete");
    mkdirSync(join(workspace, "nested"));
    writeFileSync(join(workspace, "nested", "report.md"), "report");
    const transaction = stageBotWorkspaceForDeletion("cap-delete");
    expect(() => readLocalBotFile("cap-delete", "nested/report.md")).toThrow(/not found/i);
    expect(existsSync(workspace)).toBe(false);
    transaction.rollback();
    expect(readLocalBotFile("cap-delete", "nested/report.md").bytes.toString()).toBe("report");

    const purged = stageBotWorkspaceForDeletion("cap-delete");
    purged.purge();
    expect(() => readLocalBotFile("cap-delete", "nested/report.md")).toThrow(/not found/i);
  });
});
