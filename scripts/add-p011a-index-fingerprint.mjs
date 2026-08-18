import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  let text = readFileSync(path, "utf8");
  const first = text.indexOf(needle);
  if (first < 0 || first !== text.lastIndexOf(needle)) throw new Error(`${path}:${label}: expected one match`);
  text = `${text.slice(0, first)}${replacement}${text.slice(first + needle.length)}`;
  writeFileSync(path, text);
}

replaceOnce(
  "server/message-search-index.ts",
  'import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";\n',
  'import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";\n',
  "stat import",
);
replaceOnce(
  "server/message-search-index.ts",
  `const SCHEMA_VERSION = 1;\n`,
  `const SCHEMA_VERSION = 2;\n`,
  "schema version",
);
replaceOnce(
  "server/message-search-index.ts",
  `interface IndexRow {\n  thread_id: string;\n  message_id: string;\n  at: number;\n  role: Message["role"];\n  kind: Message["kind"];\n  search_text: string;\n}\n`,
  `interface IndexRow {\n  thread_id: string;\n  message_id: string;\n  at: number;\n  role: Message["role"];\n  kind: Message["kind"];\n  search_text: string;\n}\n\nexport interface CanonicalFileFingerprint {\n  size: string;\n  inode: string;\n  mtimeNs: string;\n  ctimeNs: string;\n}\n\nexport function canonicalFileFingerprint(path: string): CanonicalFileFingerprint | null {\n  try {\n    const stat = statSync(path, { bigint: true });\n    if (!stat.isFile()) return null;\n    return {\n      size: stat.size.toString(),\n      inode: stat.ino.toString(),\n      mtimeNs: stat.mtimeNs.toString(),\n      ctimeNs: stat.ctimeNs.toString(),\n    };\n  } catch {\n    return null;\n  }\n}\n`,
  "canonical fingerprint type",
);
replaceOnce(
  "server/message-search-index.ts",
  `      CREATE INDEX IF NOT EXISTS message_search_thread_at\n        ON message_search(thread_id, at DESC);\n`,
  `      CREATE INDEX IF NOT EXISTS message_search_thread_at\n        ON message_search(thread_id, at DESC);\n      CREATE TABLE IF NOT EXISTS message_search_thread_state (\n        thread_id TEXT PRIMARY KEY,\n        canonical_size TEXT NOT NULL,\n        canonical_inode TEXT NOT NULL,\n        canonical_mtime_ns TEXT NOT NULL,\n        canonical_ctime_ns TEXT NOT NULL\n      );\n`,
  "thread fingerprint schema",
);
replaceOnce(
  "server/message-search-index.ts",
  `  hasThread(threadId: string): boolean {\n    const row = this.db.prepare("SELECT 1 AS present FROM message_search WHERE thread_id = ? LIMIT 1").get(threadId) as\n      | { present: number }\n      | undefined;\n    return row?.present === 1;\n  }\n\n  upsert(threadId: string, message: Message): void {\n`,
  `  private fingerprintMatches(threadId: string, fingerprint: CanonicalFileFingerprint): boolean {\n    const row = this.db.prepare(\n      "SELECT canonical_size, canonical_inode, canonical_mtime_ns, canonical_ctime_ns " +\n        "FROM message_search_thread_state WHERE thread_id = ?",\n    ).get(threadId) as\n      | {\n          canonical_size: string;\n          canonical_inode: string;\n          canonical_mtime_ns: string;\n          canonical_ctime_ns: string;\n        }\n      | undefined;\n    return Boolean(\n      row &&\n      row.canonical_size === fingerprint.size &&\n      row.canonical_inode === fingerprint.inode &&\n      row.canonical_mtime_ns === fingerprint.mtimeNs &&\n      row.canonical_ctime_ns === fingerprint.ctimeNs\n    );\n  }\n\n  private setFingerprint(threadId: string, fingerprint?: CanonicalFileFingerprint | null): void {\n    if (!fingerprint) {\n      this.db.prepare("DELETE FROM message_search_thread_state WHERE thread_id = ?").run(threadId);\n      return;\n    }\n    this.db.prepare(\n      "INSERT INTO message_search_thread_state(" +\n        "thread_id, canonical_size, canonical_inode, canonical_mtime_ns, canonical_ctime_ns" +\n      ") VALUES(?, ?, ?, ?, ?) " +\n      "ON CONFLICT(thread_id) DO UPDATE SET " +\n        "canonical_size = excluded.canonical_size, " +\n        "canonical_inode = excluded.canonical_inode, " +\n        "canonical_mtime_ns = excluded.canonical_mtime_ns, " +\n        "canonical_ctime_ns = excluded.canonical_ctime_ns",\n    ).run(threadId, fingerprint.size, fingerprint.inode, fingerprint.mtimeNs, fingerprint.ctimeNs);\n  }\n\n  upsert(\n    threadId: string,\n    message: Message,\n    fingerprint?: CanonicalFileFingerprint | null,\n  ): void {\n`,
  "fingerprint helpers and upsert signature",
);
replaceOnce(
  "server/message-search-index.ts",
  `        ).run(threadId, message.id, text);\n      }\n      this.db.exec("COMMIT");\n`,
  `        ).run(threadId, message.id, text);\n      }\n      this.setFingerprint(threadId, fingerprint);\n      this.db.exec("COMMIT");\n`,
  "upsert fingerprint commit",
);
replaceOnce(
  "server/message-search-index.ts",
  `  replaceThread(threadId: string, messages: readonly Message[]): void {\n`,
  `  replaceThread(\n    threadId: string,\n    messages: readonly Message[],\n    fingerprint?: CanonicalFileFingerprint | null,\n  ): void {\n`,
  "replaceThread signature",
);
replaceOnce(
  "server/message-search-index.ts",
  `        insertFts?.run(threadId, message.id, text);\n      }\n      this.db.exec("COMMIT");\n`,
  `        insertFts?.run(threadId, message.id, text);\n      }\n      this.setFingerprint(threadId, fingerprint);\n      this.db.exec("COMMIT");\n`,
  "replace fingerprint commit",
);
replaceOnce(
  "server/message-search-index.ts",
  `      this.db.prepare("DELETE FROM message_search WHERE thread_id = ?").run(threadId);\n      if (this.fts5) this.db.prepare("DELETE FROM message_search_fts WHERE thread_id = ?").run(threadId);\n      this.db.exec("COMMIT");\n`,
  `      this.db.prepare("DELETE FROM message_search WHERE thread_id = ?").run(threadId);\n      if (this.fts5) this.db.prepare("DELETE FROM message_search_fts WHERE thread_id = ?").run(threadId);\n      this.db.prepare("DELETE FROM message_search_thread_state WHERE thread_id = ?").run(threadId);\n      this.db.exec("COMMIT");\n`,
  "delete fingerprint state",
);
replaceOnce(
  "server/message-search-index.ts",
  `    // Re-check per-thread presence on every start. The global marker avoids\n    // no work by itself: a previous rollback/index failure may have removed\n    // one derived thread while leaving the marker behind. hasThread() is\n    // cheap; canonical JSON is parsed only for missing rows.\n    for (const bot of bots) {\n      if (this.hasThread(bot.threadId)) continue;\n      const path = join(DATA_DIR, \`messages-\${bot.threadId}.json\`);\n      if (!existsSync(path)) continue;\n      try {\n        const parsed = JSON.parse(readFileSync(path, "utf8"));\n        if (Array.isArray(parsed)) this.replaceThread(bot.threadId, parsed as Message[]);\n`,
  `    // A cheap stat fingerprint closes the canonical-write → derived-index\n    // crash window without parsing every transcript on every start. Atomic\n    // canonical writes replace the file, so inode/ctime/mtime/size together\n    // distinguish a newer JSON source even when message count is unchanged.\n    for (const bot of bots) {\n      const path = join(DATA_DIR, \`messages-\${bot.threadId}.json\`);\n      if (!existsSync(path)) continue;\n      const fingerprint = canonicalFileFingerprint(path);\n      if (fingerprint && this.fingerprintMatches(bot.threadId, fingerprint)) continue;\n      try {\n        const parsed = JSON.parse(readFileSync(path, "utf8"));\n        if (Array.isArray(parsed)) this.replaceThread(bot.threadId, parsed as Message[], fingerprint);\n`,
  "fingerprint-based legacy reconciliation",
);

replaceOnce(
  "server/store.ts",
  `  MESSAGE_SEARCH_DB_PATH,\n  MessageSearchIndex,\n`,
  `  MESSAGE_SEARCH_DB_PATH,\n  MessageSearchIndex,\n  canonicalFileFingerprint,\n`,
  "store fingerprint import",
);
replaceOnce(
  "server/store.ts",
  `      this.messageSearch.upsert(threadId, message);\n`,
  `      this.messageSearch.upsert(threadId, message, canonicalFileFingerprint(messagesFile(threadId)));\n`,
  "incremental fingerprint update",
);

for (const [path, needles] of Object.entries({
  "server/message-search-index.ts": [
    "message_search_thread_state",
    "canonicalFileFingerprint",
    "fingerprintMatches",
    "canonical_inode",
  ],
  "server/store.ts": ["canonicalFileFingerprint(messagesFile(threadId))"],
})) {
  const text = readFileSync(path, "utf8");
  for (const needle of needles) if (!text.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
