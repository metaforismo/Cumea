import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
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

    // Simulate the exact crash window: the canonical transaction commits but
    // the process dies before Store can update the derived search database.
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

  it("fails closed on bot deletion until canonical deletion is integrated in P0.11b3", () => {
    const store = tracked({ transcripts: true, messageSearch: true });
    const bot = store.createBot();
    expect(() => store.deleteBot(bot.id)).toThrow(/not enabled until P0\.11b3/);
    expect(store.bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));
    expect(store.messagesFor(bot.threadId)).not.toHaveLength(0);
  });
});
