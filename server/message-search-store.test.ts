import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { MESSAGE_SEARCH_DB_PATH } from "./message-search-index.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const stores = new Set<Store>();

function searchStore() {
  const store = new Store(selection, { messageSearch: true });
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

describe("Store + derived transcript search deletion", () => {
  it("restores the indexed transcript from a cold cache when metadata commit fails", () => {
    const first = searchStore();
    const bot = first.createBot();
    first.appendMessage(bot.threadId, {
      role: "user",
      kind: "text",
      text: "cold rollback sentinel 8b912f",
    });
    expect(first.searchMessages("8b912f").hits).toHaveLength(1);
    close(first);

    // A fresh Store has not loaded this transcript into its in-memory map.
    // deleteBot must capture the canonical JSON before moving it into the
    // deletion quarantine, otherwise an index rollback would restore [].
    const reloaded = searchStore();
    const botsFile = join(DATA_DIR, "bots.json");
    const backup = join(DATA_DIR, "bots-backup.json");
    renameSync(botsFile, backup);
    mkdirSync(botsFile);

    expect(() => reloaded.deleteBot(bot.id)).toThrow();
    expect(reloaded.bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));
    expect(reloaded.searchMessages("8b912f").hits).toHaveLength(1);
    expect(existsSync(join(DATA_DIR, `messages-${bot.threadId}.json`))).toBe(true);

    rmSync(botsFile, { recursive: true });
    renameSync(backup, botsFile);
    expect(reloaded.deleteBot(bot.id)).toBe(true);
    expect(reloaded.searchMessages("8b912f").hits).toEqual([]);
  });

  it("fails closed when a residual search database exists but cannot be opened", () => {
    const first = searchStore();
    const bot = first.createBot();
    first.appendMessage(bot.threadId, {
      role: "user",
      kind: "text",
      text: "residual index sentinel 4d23be",
    });
    close(first);

    // Replace the derived DB with bytes SQLite cannot parse. The canonical
    // transcript remains healthy, but deleting the bot would leave an
    // unaccounted-for indexed copy if Cumea pretended the DB did not exist.
    rmSync(MESSAGE_SEARCH_DB_PATH, { force: true });
    writeFileSync(MESSAGE_SEARCH_DB_PATH, "not a sqlite database");

    const degraded = searchStore();
    expect(degraded.searchMessages("4d23be")).toMatchObject({ available: false, hits: [] });
    expect(() => degraded.deleteBot(bot.id)).toThrow(/indexed transcript deletion cannot be guaranteed/);
    expect(degraded.bot(bot.id)).toEqual(expect.objectContaining({ id: bot.id }));
    expect(existsSync(join(DATA_DIR, `messages-${bot.threadId}.json`))).toBe(true);
  });
});
