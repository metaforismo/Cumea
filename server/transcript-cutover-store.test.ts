import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { stageFilesForDeletion } from "./delete-files.ts";
import { Store, type Message } from "./store.ts";
import { TranscriptStore } from "./transcript-store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const stores = new Set<Store>();

function tracked(options: { transcripts?: boolean; messageSearch?: boolean } = {}) {
  const store = new Store(selection, options);
  stores.add(store);
  return store;
}

function close(store: Store) {
  stores.delete(store);
  store.close();
}

beforeEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("Store canonical transcript cutover backend", () => {
  it("imports an existing JSON thread, then appends and patches without rewriting that legacy source", () => {
    const legacy = tracked({ messageSearch: true });
    const bot = legacy.createBot();
    const legacyMessage = legacy.appendMessage(bot.threadId, {
      role: "user",
      kind: "text",
      text: "legacy migration sentinel",
    });
    const legacyPath = join(DATA_DIR, `messages-${bot.threadId}.json`);
    const legacyBytes = readFileSync(legacyPath, "utf8");
    expect(legacy.searchMessages("migration sentinel").hits).toHaveLength(1);
    close(legacy);

    const cutover = tracked({ transcripts: true, messageSearch: true });
    expect(cutover.messagesFor(bot.threadId).some((message) => message.id === legacyMessage.id)).toBe(true);
    const added = cutover.appendMessage(bot.threadId, {
      role: "user",
      kind: "text",
      text: "sqlite only append sentinel",
    });
    const patched = cutover.patchMessage(bot.threadId, added.id, { text: "sqlite only patched sentinel" });
    expect(patched?.text).toBe("sqlite only patched sentinel");
    expect(cutover.searchMessages("patched sentinel").hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ botId: bot.id, messageId: added.id })]),
    );
    expect(readFileSync(legacyPath, "utf8")).toBe(legacyBytes);
    close(cutover);

    const restarted = tracked({ transcripts: true, messageSearch: true });
    expect(restarted.messagesFor(bot.threadId).find((message) => message.id === added.id)?.text)
      .toBe("sqlite only patched sentinel");
    expect(restarted.searchMessages("patched sentinel").hits).toHaveLength(1);
    expect(readFileSync(legacyPath, "utf8")).toBe(legacyBytes);
  });

  it("repairs the derived search index when canonical SQLite advanced before search upsert", () => {
    const store = tracked({ transcripts: true, messageSearch: true });
    const bot = store.createBot();
    store.appendMessage(bot.threadId, {
      role: "user",
      kind: "text",
      text: "before crash marker",
    });
    close(store);

    const canonical = new TranscriptStore();
    const direct: Message = {
      id: "direct-after-canonical-commit",
      role: "bot",
      kind: "text",
      text: "revision reconciliation sentinel",
      at: Date.now(),
    };
    canonical.append(bot.threadId, direct);
    canonical.close();

    const restarted = tracked({ transcripts: true, messageSearch: true });
    expect(restarted.messagesFor(bot.threadId).some((message) => message.id === direct.id)).toBe(true);
    expect(restarted.searchMessages("revision reconciliation").hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ botId: bot.id, messageId: direct.id })]),
    );
  });

  it("creates new cutover threads without creating whole-thread JSON files", () => {
    const store = tracked({ transcripts: true, messageSearch: true });
    const bot = store.createBot();
    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "no json rewrite" });
    expect(existsSync(join(DATA_DIR, `messages-${bot.threadId}.json`))).toBe(false);
    expect(store.searchMessages("no json rewrite").hits).toHaveLength(1);
  });

  it("deletes a canonical-only bot from metadata, canonical SQLite, cache, and derived search", () => {
    const store = tracked({ transcripts: true, messageSearch: true });
    const bot = store.createBot();
    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "canonical delete sentinel" });
    expect(store.searchMessages("canonical delete").hits).toHaveLength(1);

    expect(store.deleteBot(bot.id)).toBe(true);
    expect(store.bot(bot.id)).toBeNull();
    expect(store.searchMessages("canonical delete").hits).toEqual([]);

    close(store);
    const canonical = new TranscriptStore();
    try {
      expect(canonical.threadState(bot.threadId)).toBeNull();
    } finally {
      canonical.close();
    }
  });

  it("removes a migrated legacy JSON recovery anchor with the canonical bot", () => {
    const legacy = tracked({ messageSearch: true });
    const bot = legacy.createBot();
    legacy.appendMessage(bot.threadId, { role: "user", kind: "text", text: "legacy delete sentinel" });
    const legacyPath = join(DATA_DIR, `messages-${bot.threadId}.json`);
    expect(existsSync(legacyPath)).toBe(true);
    close(legacy);

    const cutover = tracked({ transcripts: true, messageSearch: true });
    expect(cutover.deleteBot(bot.id)).toBe(true);
    expect(existsSync(legacyPath)).toBe(false);
  });

  it("rolls canonical/search/bot state back after canonical commit when legacy-anchor purge fails", () => {
    const legacy = tracked({ messageSearch: true });
    const bot = legacy.createBot();
    legacy.appendMessage(bot.threadId, { role: "user", kind: "text", text: "purge rollback sentinel" });
    close(legacy);

    const store = tracked({ transcripts: true, messageSearch: true });
    const snapshot = [...store.messagesFor(bot.threadId)];
    const staged = stageFilesForDeletion(store.botDeletionFiles(bot.id), {
      unlink() {
        throw Object.assign(new Error("blocked cleanup"), { code: "EACCES" });
      },
    });
    const transaction = store.deleteBotRecordTransaction(bot.id, snapshot)!;
    // deleteBotRecordTransaction has already committed the canonical deletion
    // but retained its private rollback snapshot for this exact outer phase.
    expect(store.bot(bot.id)).toBeNull();
    expect(store.searchMessages("purge rollback").hits).toEqual([]);
    expect(() => staged.purge()).toThrow(/could not finalize bot file deletion/);

    transaction.rollback();
    staged.rollback();
    expect(store.bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));
    expect(store.messagesFor(bot.threadId).some((message) => message.text?.includes("purge rollback"))).toBe(true);
    expect(store.searchMessages("purge rollback").hits).toHaveLength(1);
    expect(existsSync(join(DATA_DIR, `messages-${bot.threadId}.json`))).toBe(true);
  });

  it("rolls pending canonical and search state back when bots.json metadata commit fails", () => {
    const store = tracked({ transcripts: true, messageSearch: true });
    const bot = store.createBot();
    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "metadata rollback sentinel" });
    const botsFile = join(DATA_DIR, "bots.json");
    const backup = join(DATA_DIR, "bots-backup.json");
    renameSync(botsFile, backup);
    mkdirSync(botsFile);

    expect(() => store.deleteBot(bot.id)).toThrow();
    expect(store.bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));
    expect(store.messagesFor(bot.threadId).some((message) => message.text?.includes("metadata rollback"))).toBe(true);
    expect(store.searchMessages("metadata rollback").hits).toHaveLength(1);

    rmSync(botsFile, { recursive: true });
    renameSync(backup, botsFile);
    expect(store.deleteBot(bot.id)).toBe(true);
  });
});
