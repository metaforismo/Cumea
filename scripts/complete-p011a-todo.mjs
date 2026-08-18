import { readFileSync, writeFileSync } from "node:fs";

const path = "TODO.md";
let text = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0 || first !== text.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  text = `${text.slice(0, first)}${replacement}${text.slice(first + needle.length)}`;
}
replaceOnce(
  "  - [~] P0.11a — Add the owner-local derived SQLite/WAL search projection, incremental append/patch\n",
  "  - [x] P0.11a — Add the owner-local derived SQLite/WAL search projection, incremental append/patch\n",
  "P0.11a status",
);
replaceOnce(
  "| 2026-08-18 | P0.11a | Began the owner-local derived transcript search index with incremental visible-message indexing, local-only bounded search, canonical-file fingerprint reconciliation, privacy-sensitive SQLite deletion semantics, and rollback-aware bot lifecycle; canonical JSON remains authoritative until P0.11b. |\n",
  "| 2026-08-18 | P0.11a | Completed the owner-local derived transcript search index with incremental visible-message indexing, local-only bounded search, canonical-file fingerprint reconciliation, cache-cold HTTP rollback evidence, privacy-sensitive SQLite deletion semantics, and cross-platform handle cleanup; canonical JSON remains authoritative until P0.11b. |\n",
  "P0.11a execution log",
);
writeFileSync(path, text);

// Trigger commit: workflow already exists on this branch.
