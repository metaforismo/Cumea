import { readFileSync, writeFileSync } from "node:fs";

const path = "server/index.ts";
let source = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceOnce(
  `      clearThreadEventState(bot.threadId);\n      let stagedFiles: StagedFileDeletion | null = null;\n`,
  `      clearThreadEventState(bot.threadId);\n      // Snapshot canonical transcript state while its JSON file is still at\n      // the live path. Existing bots may have a cold in-memory transcript\n      // cache after restart; once stageFilesForDeletion renames that file, a\n      // later metadata failure must still be able to rebuild the search index.\n      const transcriptSnapshot = [...store.messagesFor(bot.threadId)];\n      let stagedFiles: StagedFileDeletion | null = null;\n`,
  "pre-quarantine route snapshot",
);
replaceOnce(
  `        botTransaction = store.deleteBotRecordTransaction(bot.id);\n`,
  `        botTransaction = store.deleteBotRecordTransaction(bot.id, transcriptSnapshot);\n`,
  "pass route snapshot",
);
for (const needle of [
  "const transcriptSnapshot = [...store.messagesFor(bot.threadId)]",
  "deleteBotRecordTransaction(bot.id, transcriptSnapshot)",
]) {
  if (!source.includes(needle)) throw new Error(`missing invariant ${needle}`);
}
writeFileSync(path, source);

// Trigger commit: workflow already exists on the branch.
