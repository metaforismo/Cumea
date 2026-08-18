import { readFileSync, writeFileSync } from "node:fs";

function edit(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: no changes`);
  writeFileSync(path, after);
}
function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

edit("README.md", (input) => {
  let source = replaceOnce(
    input,
    `- sections, sidebar search, an owner-local bounded transcript search index, file attachments,\n  reusable routines, and a “Needs you” inbox;\n`,
    `- sections, one desktop search surface across agents and visible transcript messages, exact-message\n  navigation, bounded local transcript export, file attachments, reusable routines, and a “Needs you” inbox;\n`,
    "README search feature",
  );
  source = replaceOnce(
    source,
    `The renderer owns no provider transport. Commands cross the local API, providers emit one canonical\nevent stream, and the UI folds that stream into visible conversation state. The production harness\n`,
    `The renderer owns no provider transport. Commands cross the local API, providers emit one canonical\nevent stream, and the UI folds that stream into visible conversation state. The desktop sidebar search\nnow combines agent metadata with the owner-local transcript index; a message hit opens a bounded window\naround the exact message, highlights it, and offers Return to latest without loading the whole thread.\nChat headers can export a bounded Markdown transcript, while JSON remains an API primitive. Both exact\nnavigation and export are local-only and never added to the paired mobile surface. The production harness\n`,
    "README P0.11c boundary",
  );
  return source;
});

edit("CHANGELOG.md", (input) => {
  let source = replaceOnce(
    input,
    `- Activated canonical transcript persistence in the real harness. Folded history now reads, appends\n  and patches through owner-local \`transcripts.sqlite\` without whole-thread JSON rewrites; existing\n  legacy JSON remains an immutable migration/recovery anchor until its bot is deleted, and new bots\n  create no JSON transcript. The derived search index reconciles against canonical revisions.\n`,
    `- Activated canonical transcript persistence in the real harness. Folded history now reads, appends\n  and patches through owner-local \`transcripts.sqlite\` without whole-thread JSON rewrites; existing\n  legacy JSON remains an immutable migration/recovery anchor until its bot is deleted, and new bots\n  create no JSON transcript. The derived search index reconciles against canonical revisions.\n- Added global desktop transcript search to the existing agent search field, bounded exact-message\n  navigation with highlighted focus and Return to latest, plus bounded Markdown/JSON visible-transcript\n  export. Search jumps do not load entire long conversations.\n`,
    "CHANGELOG P0.11c added",
  );
  source = replaceOnce(
    source,
    `### Security\n\n- Canonical bot deletion is a rollback-capable cross-store transaction: SQLite first enters\n`,
    `### Security\n\n- Exact transcript navigation and export remain desktop-local. Export projects only folded visible fields:\n  raw screen bytes, provider-native/request identifiers, attachment IDs, resume cursors and filesystem paths\n  are excluded; screenshot messages are represented only by an explicit omission marker.\n- Canonical bot deletion is a rollback-capable cross-store transaction: SQLite first enters\n`,
    "CHANGELOG P0.11c security",
  );
  return source;
});

edit("TODO.md", (input) => {
  let source = replaceOnce(
    input,
    `- [~] **P0.11 — Incremental transcript persistence and local search index.** Replace whole-thread JSON\n`,
    `- [x] **P0.11 — Incremental transcript persistence and local search index.** Replace whole-thread JSON\n`,
    "P0.11 status",
  );
  source = replaceOnce(
    source,
    `  - [ ] P0.11c — Add desktop global search/navigation, exact message jumping, transcript export, and\n    UX tests on top of the local index without widening the mobile/remote privacy surface.\n`,
    `  - [x] P0.11c — Integrate visible transcript hits into the existing desktop search field, load bounded\n    exact-message windows instead of whole threads, highlight and return to latest, add bounded Markdown/JSON\n    visible-transcript export, and keep exact navigation/export off the mobile/remote surface.\n`,
    "P0.11c status",
  );
  const needle = `| 2026-08-18 | P0.11b3 | Activated canonical transcript SQLite in the real harness with rollback-capable post-COMMIT deletion, pending-delete restart recovery, canonical/search/metadata/file rollback evidence, immutable legacy migration anchors, canonical-only new threads, and cross-platform CI. |\n`;
  source = replaceOnce(
    source,
    needle,
    `${needle}| 2026-08-18 | P0.11c | Completed global desktop transcript search/navigation and bounded visible export on the local index, with exact-focus windows, Return to latest, export redaction, paired-remote denial, and cross-platform CI. P0.11 is complete. |\n`,
    "P0.11c execution log",
  );
  return source;
});

for (const [path, needles] of Object.entries({
  "README.md": ["one desktop search surface", "Return to latest", "local-only"],
  "CHANGELOG.md": ["global desktop transcript search", "Exact transcript navigation and export remain desktop-local"],
  "TODO.md": ["- [x] **P0.11 —", "- [x] P0.11c —", "P0.11 is complete"],
})) {
  const text = readFileSync(path, "utf8");
  for (const needle of needles) if (!text.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
