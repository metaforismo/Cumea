import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

replaceOnce(
  "TODO.md",
  '  - [ ] P0.12c — Add dispatch-based engine/session freshness. Record which provider instance last ran the\n',
  '  - [x] P0.12c — Add dispatch-based engine/session freshness. Record which provider instance last ran the\n',
  "P0.12c status",
);
replaceOnce(
  "TODO.md",
  '| 2026-08-18 | P1.11a | Added a desktop-local bounded Runtime inspector over existing normalized and secret-redacted native thread logs, with Events/Raw lenses, payload clipping, torn-line tolerance, real-harness local/no-store evidence, authenticated mobile denial, and right-slot UI integration. |',
  '| 2026-08-18 | P1.11a | Added a desktop-local bounded Runtime inspector over existing normalized and secret-redacted native thread logs, with Events/Raw lenses, payload clipping, torn-line tolerance, real-harness local/no-store evidence, authenticated mobile denial, and right-slot UI integration. |\n| 2026-08-18 | P0.12c | Added dispatch-based native-session freshness with private per-thread pending/dispatched/invalidated state, A→B→A and unsupported-model rebuilds, provider-reload invalidation, bounded canonical context, shared native cursor refusal, successful-turn confirmation, and fake-Claude rebuild evidence. |',
  "P0.12c execution log",
);

replaceOnce(
  "README.md",
  '| `server/message-search-index.ts` | owner-local derived SQLite/WAL transcript search projection with legacy-file fingerprints and canonical-revision reconciliation |\n',
  '| `server/message-search-index.ts` | owner-local derived SQLite/WAL transcript search projection with legacy-file fingerprints and canonical-revision reconciliation |\n| `server/turn-context.ts` | bounded canonical context rebuild and native-session resume decision |\n| `server/session-freshness.ts` | private owner-local per-thread pending/dispatched/invalidated provider-session state |\n',
  "README freshness architecture",
);
replaceOnce(
  "README.md",
  '“Teach as routine” currently captures a completed bot task and its prompt; it does not yet record a\n',
  'Switching a conversation between provider instances no longer trusts a cursor merely because it exists.\nCumea records private per-thread dispatch freshness and resumes a native session only when that instance/model\nstill represents the latest successful turn. Provider reloads, A→B→A routing, interrupted dispatches and\nunsupported in-session model changes start a new native session with bounded canonical transcript context.\nSee [engine/session freshness](docs/session-freshness.md).\n\n“Teach as routine” currently captures a completed bot task and its prompt; it does not yet record a\n',
  "README freshness behavior",
);

replaceOnce(
  "CHANGELOG.md",
  '### Changed\n\n',
  '### Changed\n\n- Native provider continuation is now dispatch-fresh rather than cursor-presence based. A→B→A routing,\n  provider reloads, interrupted dispatches and unsupported in-session model changes rebuild bounded canonical\n  conversation context in a fresh native session instead of trusting stale provider state.\n',
  "CHANGELOG freshness changed",
);
replaceOnce(
  "CHANGELOG.md",
  '### Security\n\n',
  '### Security\n\n- Session freshness metadata is owner-local and contains only thread/instance/model lifecycle state. Rebuilt\n  conversation history is size-bounded and quoted inside the next user turn, never promoted into the system\n  prompt; native drivers independently refuse any supplied resume cursor while rebuild is required.\n',
  "CHANGELOG freshness security",
);

for (const [path, needles] of Object.entries({
  "TODO.md": ['- [x] P0.12c —', '| 2026-08-18 | P0.12c |'],
  "README.md": ['`server/session-freshness.ts`', '[engine/session freshness](docs/session-freshness.md)'],
  "CHANGELOG.md": ['Native provider continuation is now dispatch-fresh', 'Session freshness metadata is owner-local'],
})) {
  const source = readFileSync(path, "utf8");
  for (const needle of needles) if (!source.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
