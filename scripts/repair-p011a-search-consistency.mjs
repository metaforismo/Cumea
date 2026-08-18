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
  `  seedLegacy(bots: readonly BotRecord[]): void {\n    const marker = this.db.prepare("SELECT value FROM message_search_meta WHERE key = 'legacy_seed_v1'").get() as\n      | { value: string }\n      | undefined;\n    if (marker?.value === "complete") return;\n\n    for (const bot of bots) {\n`,
  `  seedLegacy(bots: readonly BotRecord[]): void {\n    // Re-check per-thread presence on every start. The global marker avoids\n    // no work by itself: a previous rollback/index failure may have removed\n    // one derived thread while leaving the marker behind. hasThread() is\n    // cheap; canonical JSON is parsed only for missing rows.\n    for (const bot of bots) {\n`,
  "self-healing legacy seed",
);

replaceOnce(
  "server/store.ts",
  `    if (this.messageSearch) {\n      try {\n        this.messageSearch.deleteThread(bot.threadId);\n      } catch (error) {\n        throw Object.assign(new Error("could not remove transcript from local search index"), {\n          status: 500,\n          cause: error,\n        });\n      }\n    }\n`,
  `    if (this.messageSearch) {\n      try {\n        this.messageSearch.deleteThread(bot.threadId);\n      } catch (error) {\n        // deleteThread can fail after SQLite committed the logical DELETE\n        // (for example while enforcing the privacy checkpoint). Restore the\n        // derived rows before reporting a failed bot deletion so the visible\n        // bot never survives with a silently missing search transcript.\n        try {\n          this.messageSearch.replaceThread(bot.threadId, searchSnapshot);\n        } catch (restoreError) {\n          this.disableMessageSearch(restoreError);\n          throw Object.assign(\n            new Error("could not remove transcript from local search index and restore the derived index"),\n            { status: 500, cause: new AggregateError([error, restoreError]) },\n          );\n        }\n        throw Object.assign(new Error("could not remove transcript from local search index"), {\n          status: 500,\n          cause: error,\n        });\n      }\n    }\n`,
  "restore after index delete failure",
);

for (const [path, needles] of Object.entries({
  "server/message-search-index.ts": ["Re-check per-thread presence on every start", "hasThread(bot.threadId)"],
  "server/store.ts": ["deleteThread can fail after SQLite committed", "new AggregateError([error, restoreError])"],
})) {
  const text = readFileSync(path, "utf8");
  for (const needle of needles) if (!text.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
