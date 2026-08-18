import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const before = readFileSync(path, "utf8");
  const first = before.indexOf(needle);
  if (first < 0 || first !== before.lastIndexOf(needle)) {
    throw new Error(`${path}:${label}: expected exactly one match`);
  }
  const after = `${before.slice(0, first)}${replacement}${before.slice(first + needle.length)}`;
  writeFileSync(path, after);
}

replaceOnce(
  "server/store.ts",
  `    let canonicalCommitted = false;\n    let settled = false;\n    return {\n`,
  `    let canonicalCommitted = !canonicalTransaction;\n    let settled = false;\n\n    // The real HTTP delete path already stages all external files before it\n    // asks Store to prepare metadata. Commit canonical SQLite here, before\n    // returning to that outer path. The TranscriptStore transaction retains\n    // its private rollback snapshot until finalize(), so a later attachment /\n    // event-log / legacy-anchor purge failure can still restore every row.\n    if (canonicalTransaction) {\n      try {\n        canonicalTransaction.commit();\n        canonicalCommitted = true;\n      } catch (error) {\n        const rollbackErrors = [];\n        this.bots = previousBots;\n        try { this.saveBots(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }\n        try { canonicalTransaction.rollback(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }\n        try { restoreSearch(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }\n        if (rollbackErrors.length) {\n          throw Object.assign(new Error("canonical transcript commit failed and deletion rollback was incomplete"), {\n            status: 500,\n            cause: new AggregateError([error, ...rollbackErrors]),\n          });\n        }\n        throw error;\n      }\n    }\n\n    return {\n`,
  "commit canonical before outer purge",
);

replaceOnce(
  "server/index.ts",
  `const store = new Store(() => bootSelection, { messageSearch: true });\n`,
  `const store = new Store(() => bootSelection, { messageSearch: true, transcripts: true });\n`,
  "enable canonical transcript backend",
);

for (const [path, needles] of Object.entries({
  "server/store.ts": [
    "let canonicalCommitted = !canonicalTransaction",
    "canonical transcript commit failed and deletion rollback was incomplete",
  ],
  "server/index.ts": ["{ messageSearch: true, transcripts: true }"],
})) {
  const text = readFileSync(path, "utf8");
  for (const needle of needles) if (!text.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
