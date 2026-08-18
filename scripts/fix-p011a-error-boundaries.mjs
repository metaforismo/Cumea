import { readFileSync, writeFileSync } from "node:fs";

const path = "server/message-search-index.ts";
let source = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceOnce(
  `      try {\n        db.exec(\`\n          CREATE VIRTUAL TABLE IF NOT EXISTS message_search_fts USING fts5(\n            thread_id UNINDEXED,\n            message_id UNINDEXED,\n            search_text,\n            tokenize = 'unicode61 remove_diacritics 2'\n          );\n        \`);\n        this.fts5 = true;\n      } catch {\n        this.fts5 = false;\n      }\n`,
  `      try {\n        db.exec(\`\n          CREATE VIRTUAL TABLE IF NOT EXISTS message_search_fts USING fts5(\n            thread_id UNINDEXED,\n            message_id UNINDEXED,\n            search_text,\n            tokenize = 'unicode61 remove_diacritics 2'\n          );\n        \`);\n        this.fts5 = true;\n      } catch (error) {\n        const message = error instanceof Error ? error.message : String(error);\n        if (!/no such module:\\s*fts5/i.test(message)) throw error;\n        this.fts5 = false;\n      }\n`,
  "FTS5 fallback boundary",
);

replaceOnce(
  `      try {\n        const parsed = JSON.parse(readFileSync(path, "utf8"));\n        if (Array.isArray(parsed)) this.replaceThread(bot.threadId, parsed as Message[], fingerprint);\n      } catch {\n        // Match Store's existing recovery behavior: an unreadable/corrupt\n        // legacy transcript is not allowed to prevent the rest of Cumea from\n        // starting or indexing healthy threads.\n      }\n`,
  `      let parsed: unknown;\n      try {\n        parsed = JSON.parse(readFileSync(path, "utf8"));\n      } catch {\n        // Match Store's existing recovery behavior: an unreadable/corrupt\n        // canonical transcript is isolated to this thread. SQLite failures\n        // are deliberately outside this catch and must disable the index.\n        continue;\n      }\n      if (Array.isArray(parsed)) this.replaceThread(bot.threadId, parsed as Message[], fingerprint);\n`,
  "legacy parse versus SQLite error boundary",
);

for (const needle of [
  "no such module:\\s*fts5",
  "SQLite failures",
  "if (Array.isArray(parsed)) this.replaceThread",
]) {
  if (!source.includes(needle)) throw new Error(`missing invariant ${needle}`);
}
writeFileSync(path, source);
