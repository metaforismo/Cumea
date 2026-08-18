import { readFileSync, writeFileSync } from "node:fs";

function edit(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: transform made no changes`);
  writeFileSync(path, after);
}
function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

edit("README.md", (input) => replaceOnce(
  input,
  `The renderer owns no provider transport. Commands cross the local API, providers emit one canonical\nevent stream, and the UI folds that stream into visible conversation state. P0.11b2 adds a guarded\n\`Store({ transcripts: true })\` backend that imports owned legacy threads fail-closed, reads/appends/\npatches canonical SQLite incrementally, and reconciles the derived search index against canonical\nthread revisions. Existing legacy JSON remains byte-identical as a migration recovery anchor and new\ncutover threads create no whole-thread JSON file. The real harness deliberately stays on the legacy\nbackend until P0.11b3 integrates and proves canonical bot deletion before enabling the cutover in\nproduction. See [local transcript search](docs/transcript-search.md) and\n[canonical transcript persistence](docs/transcript-persistence.md).\n`,
  `The renderer owns no provider transport. Commands cross the local API, providers emit one canonical\nevent stream, and the UI folds that stream into visible conversation state. The production harness\nnow stores folded conversation history incrementally in owner-local \`transcripts.sqlite\`; legacy\n\`messages-<threadId>.json\` files are verified migration/recovery anchors only, are never rewritten,\nand are removed with their migrated bot. New threads create no whole-thread JSON file. The separate\nsearch database remains derived and reconciles against canonical transcript revisions. Bot deletion\nuses a rollback-capable SQLite prepare/commit phase before purging attachments, event/native logs and\nlegacy anchors, so a later purge failure can still reconstruct a committed transcript exactly. See\n[local transcript search](docs/transcript-search.md) and\n[canonical transcript persistence](docs/transcript-persistence.md).\n`,
  "README canonical production boundary",
));

edit("CHANGELOG.md", (input) => {
  let source = replaceOnce(
    input,
    `- Added a guarded canonical Store backend that reads/appends/patches folded transcripts through\n  SQLite without rewriting the legacy JSON source, plus canonical-revision reconciliation for the\n  derived transcript search index. The real harness remains on the legacy backend until P0.11b3\n  proves canonical deletion and enables the cutover.\n`,
    `- Activated canonical transcript persistence in the real harness. Folded history now reads, appends\n  and patches through owner-local \`transcripts.sqlite\` without whole-thread JSON rewrites; existing\n  legacy JSON remains an immutable migration/recovery anchor until its bot is deleted, and new bots\n  create no JSON transcript. The derived search index reconciles against canonical revisions.\n`,
    "CHANGELOG activation",
  );
  source = replaceOnce(
    source,
    `- The guarded canonical Store backend refuses bot deletion until P0.11b3 connects \`pending_delete\`\n  to the complete HTTP/workspace/filesystem deletion transaction. This prevents a user-visible delete\n  from succeeding while canonical SQLite rows could remain behind.\n`,
    `- Canonical bot deletion is a rollback-capable cross-store transaction: SQLite first enters\n  \`pending_delete\`, commits and privacy-checkpoints the transcript while retaining an exact private\n  rollback snapshot, then outer bot/workspace/file purges run, and only a successful full purge releases\n  that snapshot. Metadata, search, legacy-anchor, checkpoint and post-commit purge failures are tested.\n`,
    "CHANGELOG deletion security",
  );
  return source;
});

edit("TODO.md", (input) => {
  let source = replaceOnce(
    input,
    `  - [~] P0.11b — Migrate the canonical transcript source of truth from whole-thread JSON rewrites to\n`,
    `  - [x] P0.11b — Migrate the canonical transcript source of truth from whole-thread JSON rewrites to\n`,
    "P0.11b status",
  );
  source = replaceOnce(
    source,
    `    - [ ] P0.11b3 — Integrate canonical pending-delete recovery with the real HTTP bot deletion path,\n      prove crash/restart and privacy cleanup windows, enable the canonical Store backend in production,\n      document backup/restore operations, and retire active JSON writes without weakening rollback.\n`,
    `    - [x] P0.11b3 — Integrate canonical pending-delete recovery with the real HTTP bot deletion path,\n      prove crash/restart and post-COMMIT privacy cleanup windows, enable the canonical Store backend in\n      production, preserve immutable legacy migration anchors without rewriting them, remove them on bot\n      deletion, and retain tested local backup/recovery primitives.\n`,
    "P0.11b3 status",
  );
  const logNeedle = `| 2026-08-18 | P0.11b2 | Completed the guarded Store cutover backend with verified legacy import, SQLite-only incremental appends/patches, canonical-revision search reconciliation, restart/crash evidence, no new whole-thread JSON files, and fail-closed deletion until b3; the real harness remains legacy-backed until b3 enables it. |\n`;
  source = replaceOnce(
    source,
    logNeedle,
    `${logNeedle}| 2026-08-18 | P0.11b3 | Activated canonical transcript SQLite in the real harness with rollback-capable post-COMMIT deletion, pending-delete restart recovery, canonical/search/metadata/file rollback evidence, immutable legacy migration anchors, canonical-only new threads, and cross-platform CI. |\n`,
    "P0.11b3 execution log",
  );
  return source;
});

for (const [path, needles] of Object.entries({
  "README.md": ["production harness", "rollback-capable SQLite prepare/commit"],
  "CHANGELOG.md": ["Activated canonical transcript persistence", "post-commit purge failures"],
  "TODO.md": ["- [x] P0.11b — Migrate", "- [x] P0.11b3 — Integrate", "P0.11b3 | Activated"],
})) {
  const text = readFileSync(path, "utf8");
  for (const needle of needles) if (!text.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
