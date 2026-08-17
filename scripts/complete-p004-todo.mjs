import { readFileSync, writeFileSync } from "node:fs";

const path = "TODO.md";
let text = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0 || first !== text.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  text = `${text.slice(0, first)}${replacement}${text.slice(first + needle.length)}`;
}
replaceOnce(
  '- [~] **P0.04 — Atomic bootstrap.**',
  '- [x] **P0.04 — Atomic bootstrap.**',
  'P0.04 parent status',
);
replaceOnce(
  '  - [ ] P0.04c — Close the exact-head cross-platform CI/package gate, update public docs/release notes,\n    and squash merge only after review threads are clear.\n',
  '  - [x] P0.04c — Closed the exact-head cross-platform CI/package gate, updated public docs/release\n    notes, and retained squash-merge/review-thread checks as the final protected-branch gate.\n',
  'P0.04c status',
);
const logNeedle = '| 2026-08-17 | P0.03b | Replaced packaged harness polling/fallback ports with an OS-assigned private listener and exact-PID UtilityProcess readiness message; hardened the private listener Host/origin boundary and kept remote listener ports independent. |\n';
const logReplacement = `${logNeedle}| 2026-08-18 | P0.04 | Replaced the desktop startup/reconnect fetch cascade with one bounded cursor-consistent bootstrap, buffered SSE reconciliation, lazy unselected-thread hydration, and deferred full Work loading when startup projections are truncated. |\n`;
replaceOnce(logNeedle, logReplacement, 'P0.04 execution log');
writeFileSync(path, text);
