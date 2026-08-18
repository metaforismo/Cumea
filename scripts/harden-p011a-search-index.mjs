import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  let text = readFileSync(path, "utf8");
  const first = text.indexOf(needle);
  if (first < 0 || first !== text.lastIndexOf(needle)) {
    throw new Error(`${path}:${label}: expected exactly one match`);
  }
  text = `${text.slice(0, first)}${replacement}${text.slice(first + needle.length)}`;
  writeFileSync(path, text);
}

replaceOnce(
  "server/message-search-index.ts",
  'import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";\n',
  'import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";\n',
  "owner-only precreate imports",
);
replaceOnce(
  "server/message-search-index.ts",
  `    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });\n    this.db = new DatabaseSync(path);\n    try { chmodSync(path, 0o600); } catch {}\n    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;");\n`,
  `    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });\n    // Create/repair the containing database path as owner-only before SQLite\n    // opens it. DATA_DIR is already 0700, but the file itself should never\n    // spend even a short creation window under a permissive umask.\n    closeSync(openSync(path, "a", 0o600));\n    try { chmodSync(path, 0o600); } catch {}\n    this.db = new DatabaseSync(path);\n    this.db.exec(\n      "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;",\n    );\n`,
  "owner-only database open",
);
replaceOnce(
  "server/message-search-index.ts",
  `      this.db.exec("COMMIT");\n    } catch (error) {\n      try { this.db.exec("ROLLBACK"); } catch {}\n      throw error;\n    }\n  }\n\n  seedLegacy`,
  `      this.db.exec("COMMIT");\n      // secure_delete scrubs deleted cells in the database. Truncating the\n      // WAL after a privacy-sensitive thread deletion also removes older WAL\n      // frames that could otherwise retain the indexed text until a later\n      // checkpoint. This index is local/derived and has one owning process.\n      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");\n    } catch (error) {\n      try { this.db.exec("ROLLBACK"); } catch {}\n      throw error;\n    }\n  }\n\n  seedLegacy`,
  "privacy-sensitive delete checkpoint",
);

replaceOnce(
  "server/store.ts",
  `  constructor(defaultSelection: () => ModelSelection) {\n    this.defaultSelection = defaultSelection;\n`,
  `  constructor(defaultSelection: () => ModelSelection, options: { messageSearch?: boolean } = {}) {\n    this.defaultSelection = defaultSelection;\n`,
  "Store search option",
);
replaceOnce(
  "server/store.ts",
  `    if (migrated) this.saveBots();\n    try {\n      this.messageSearch = new MessageSearchIndex();\n      this.messageSearch.seedLegacy(this.bots);\n      this.messageSearchHasResidualData = false;\n    } catch (error) {\n      this.messageSearch = null;\n      this.messageSearchHasResidualData = existsSync(MESSAGE_SEARCH_DB_PATH);\n      console.warn(\n        "[message-search] local transcript search is unavailable:",\n        error instanceof Error ? error.message : String(error),\n      );\n    }\n`,
  `    if (migrated) this.saveBots();\n    if (options.messageSearch) {\n      try {\n        this.messageSearch = new MessageSearchIndex();\n        this.messageSearch.seedLegacy(this.bots);\n        this.messageSearchHasResidualData = false;\n      } catch (error) {\n        this.messageSearch = null;\n        this.messageSearchHasResidualData = existsSync(MESSAGE_SEARCH_DB_PATH);\n        console.warn(\n          "[message-search] local transcript search is unavailable:",\n          error instanceof Error ? error.message : String(error),\n        );\n      }\n    }\n`,
  "conditional derived index",
);
replaceOnce(
  "server/store.ts",
  `  deleteBot(id: string): boolean {\n    const bot = this.bot(id);\n    if (!bot) return false;\n\n    const files = stageFilesForDeletion(this.botDeletionFiles(id));\n`,
  `  deleteBot(id: string): boolean {\n    const bot = this.bot(id);\n    if (!bot) return false;\n\n    // Capture canonical transcript state before the JSON file is moved into\n    // the deletion quarantine. A cold Store cache must still be able to\n    // reconstruct the derived search index if a later metadata commit fails.\n    const transcriptSnapshot = [...this.messagesFor(bot.threadId)];\n    const files = stageFilesForDeletion(this.botDeletionFiles(id));\n`,
  "pre-quarantine transcript snapshot",
);
replaceOnce(
  "server/store.ts",
  `      transaction = this.deleteBotRecordTransaction(id);\n`,
  `      transaction = this.deleteBotRecordTransaction(id, transcriptSnapshot);\n`,
  "pass delete snapshot",
);
replaceOnce(
  "server/store.ts",
  `  deleteBotRecordTransaction(id: string): BotRecordDeletionTransaction | null {\n    const bot = this.bot(id);\n    if (!bot) return null;\n`,
  `  deleteBotRecordTransaction(\n    id: string,\n    transcriptSnapshot: readonly Message[] = this.messagesFor(this.bot(id)?.threadId ?? ""),\n  ): BotRecordDeletionTransaction | null {\n    const bot = this.bot(id);\n    if (!bot) return null;\n`,
  "delete transaction snapshot parameter",
);
replaceOnce(
  "server/store.ts",
  `    const transcriptSnapshot = [...this.messagesFor(bot.threadId)];\n    if (this.messageSearch) {\n`,
  `    const searchSnapshot = [...transcriptSnapshot];\n    if (this.messageSearch) {\n`,
  "rename search snapshot",
);
replaceOnce(
  "server/store.ts",
  `        this.messageSearch.replaceThread(bot.threadId, transcriptSnapshot);\n`,
  `        this.messageSearch.replaceThread(bot.threadId, searchSnapshot);\n`,
  "restore search snapshot",
);
replaceOnce(
  "server/store.ts",
  `  patchBot(id: string, patch: Partial<BotRecord>): BotRecord | null {\n`,
  `  close(): void {\n    try { this.messageSearch?.close(); } catch {}\n    this.messageSearch = null;\n  }\n\n  patchBot(id: string, patch: Partial<BotRecord>): BotRecord | null {\n`,
  "Store close hook",
);

replaceOnce(
  "server/index.ts",
  `const store = new Store(() => bootSelection);\n`,
  `const store = new Store(() => bootSelection, { messageSearch: true });\n`,
  "enable production search index",
);
replaceOnce(
  "server/index.ts",
  `    remoteServer?.close();\n    server.close();\n    void registry.disposeAll().finally(() => process.exit(0));\n`,
  `    remoteServer?.close();\n    server.close();\n    store.close();\n    void registry.disposeAll().finally(() => process.exit(0));\n`,
  "close search database on shutdown",
);

for (const [path, needles] of Object.entries({
  "server/message-search-index.ts": ["PRAGMA secure_delete=ON", "wal_checkpoint(TRUNCATE)", 'openSync(path, "a", 0o600)'],
  "server/store.ts": ["const transcriptSnapshot = [...this.messagesFor(bot.threadId)]", "searchSnapshot", "close(): void", "options.messageSearch"],
  "server/index.ts": ["{ messageSearch: true }", "store.close();"],
})) {
  const text = readFileSync(path, "utf8");
  for (const needle of needles) if (!text.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
