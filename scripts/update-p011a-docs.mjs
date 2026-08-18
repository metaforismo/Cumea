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
  "TODO.md",
  `- [ ] **P0.11 — Incremental transcript persistence and local search index.** Replace whole-thread JSON\n  rewrite amplification with a versioned owner-local SQLite/WAL message store, lazy verified legacy\n  import, per-message insert/update, rollback-aware thread deletion, bounded transcript search, and\n  export primitives without making provider-private payloads searchable by default.\n`,
  `- [~] **P0.11 — Incremental transcript persistence and local search index.** Replace whole-thread JSON\n  rewrite amplification with a versioned owner-local SQLite/WAL message store, lazy verified legacy\n  import, per-message insert/update, rollback-aware thread deletion, bounded transcript search, and\n  export primitives without making provider-private payloads searchable by default.\n  - [~] P0.11a — Add the owner-local derived SQLite/WAL search projection, incremental append/patch\n    indexing, local-only bounded search API, privacy-safe field projection, self-healing legacy seed,\n    secure-delete/WAL cleanup, rollback-aware bot deletion, and cross-platform handle lifecycle.\n  - [ ] P0.11b — Migrate the canonical transcript source of truth from whole-thread JSON rewrites to\n    versioned incremental SQLite with atomic verified legacy import, crash recovery, rollback-safe\n    deletion, and explicit recovery/backup evidence before retiring canonical JSON writes.\n  - [ ] P0.11c — Add desktop global search/navigation, exact message jumping, transcript export, and\n    UX tests on top of the local index without widening the mobile/remote privacy surface.\n`,
  "P0.11 tranche split",
);
replaceOnce(
  "TODO.md",
  `| 2026-08-18 | Competitive audit | Re-audited Cumea against Rakazo \`2718b1f\` and OpenMausBot \`4a9d654\`; retained Cumea's privacy/security model while promoting transcript SQLite/search, liveness protection, renderer/thread scaling, inspectable memory, visual journey evidence, and pluggable user-owned computer backends into explicit roadmap gates. |\n`,
  `| 2026-08-18 | Competitive audit | Re-audited Cumea against Rakazo \`2718b1f\` and OpenMausBot \`4a9d654\`; retained Cumea's privacy/security model while promoting transcript SQLite/search, liveness protection, renderer/thread scaling, inspectable memory, visual journey evidence, and pluggable user-owned computer backends into explicit roadmap gates. |\n| 2026-08-18 | P0.11a | Began the owner-local derived transcript search index with incremental visible-message indexing, local-only bounded search, self-healing legacy projection, privacy-sensitive SQLite deletion semantics, and rollback-aware bot lifecycle; canonical JSON remains authoritative until P0.11b. |\n`,
  "P0.11a execution log",
);

replaceOnce(
  "README.md",
  `- sections, real sidebar search, file attachments, reusable routines, and a “Needs you” inbox;\n`,
  `- sections, sidebar search, an owner-local bounded transcript search index, file attachments,\n  reusable routines, and a “Needs you” inbox;\n`,
  "README feature bullet",
);
replaceOnce(
  "README.md",
  `| \`server/workspace.ts\` | durable sections, attachments, tasks, runs, artifacts, and schedules |\n`,
  `| \`server/workspace.ts\` | durable sections, attachments, tasks, runs, artifacts, and schedules |\n| \`server/message-search-index.ts\` | owner-local derived SQLite/WAL transcript search projection; canonical JSON remains authoritative in P0.11a |\n`,
  "README architecture row",
);
replaceOnce(
  "README.md",
  `The renderer owns no provider transport. Commands cross the local API, providers emit one canonical\nevent stream, and the UI folds that stream into visible conversation state.\n`,
  `The renderer owns no provider transport. Commands cross the local API, providers emit one canonical\nevent stream, and the UI folds that stream into visible conversation state. Local transcript search\nuses a separate derived SQLite/WAL projection over user-visible message fields only; the canonical\ntranscript is still the rollback-safe JSON record until P0.11b. See\n[local transcript search](docs/transcript-search.md).\n`,
  "README search boundary paragraph",
);

replaceOnce(
  "CHANGELOG.md",
  `- Desktop state now has a versioned, bounded local bootstrap snapshot with a monotonic SSE cursor.\n  Startup and reconnect buffer concurrent deltas, hydrate bots/configuration/engines/work state once,\n  discard events already represented by the snapshot, and re-snapshot rather than guessing after a\n  bounded-buffer overflow.\n`,
  `- Desktop state now has a versioned, bounded local bootstrap snapshot with a monotonic SSE cursor.\n  Startup and reconnect buffer concurrent deltas, hydrate bots/configuration/engines/work state once,\n  discard events already represented by the snapshot, and re-snapshot rather than guessing after a\n  bounded-buffer overflow.\n- Added an owner-local derived SQLite/WAL transcript search index and local-only bounded search API.\n  It incrementally follows visible folded messages, excludes raw/provider-private fields, self-heals\n  missing legacy projections, and keeps canonical JSON as the recovery source until P0.11b.\n`,
  "CHANGELOG P0.11a added",
);
replaceOnce(
  "CHANGELOG.md",
  `### Security\n\n`,
  `### Security\n\n- Transcript-index deletion is privacy-sensitive: the derived DB is owner-only, uses SQLite\n  \`secure_delete\`, requires a WAL truncate checkpoint for thread deletion, fails closed if a\n  residual index cannot be opened, and restores indexed rows when the surrounding bot deletion\n  transaction rolls back. The search endpoint remains desktop-local only.\n`,
  "CHANGELOG P0.11a security",
);
