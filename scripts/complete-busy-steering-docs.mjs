import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

replaceOnce(
  "TODO.md",
  '  - [ ] P0.12b — Persist explicit user messages sent while a bot is busy, mark them visibly queued, bound\n',
  '  - [x] P0.12b — Persist explicit user messages sent while a bot is busy, mark them visibly queued, bound\n',
  "P0.12b status",
);
replaceOnce(
  "TODO.md",
  '| 2026-08-18 | P0.12c | Added dispatch-based native-session freshness with private per-thread pending/dispatched/invalidated state, A→B→A and unsupported-model rebuilds, provider-reload invalidation, bounded canonical context, shared native cursor refusal, successful-turn confirmation, and fake-Claude rebuild evidence. |',
  '| 2026-08-18 | P0.12c | Added dispatch-based native-session freshness with private per-thread pending/dispatched/invalidated state, A→B→A and unsupported-model rebuilds, provider-reload invalidation, bounded canonical context, shared native cursor refusal, successful-turn confirmation, and fake-Claude rebuild evidence. |\n| 2026-08-19 | P0.12b | Added bounded attended busy-user steering with canonical queued/dispatching/failed delivery state, one-follow-up coalescing, atomic batch claims, at-most-once crash/reload behavior, desktop/mobile Stop+Send controls, and real-harness recovery/no-duplication evidence. |',
  "P0.12b execution log",
);

replaceOnce(
  "README.md",
  '- a desktop-local Runtime inspector with bounded Events and Raw provider diagnostics for the active agent.\n',
  '- a desktop-local Runtime inspector with bounded Events and Raw provider diagnostics for the active agent;\n- attended busy-user steering: send additional direction while an agent is working, with a bounded durable queue and one coalesced follow-up turn.\n',
  "README feature list",
);
replaceOnce(
  "README.md",
  'See [engine/session freshness](docs/session-freshness.md).\n\n“Teach as routine” currently captures',
  'See [engine/session freshness](docs/session-freshness.md).\n\nWhile an agent is already working, desktop and paired mobile keep the composer usable. Explicit user messages are persisted immediately as bounded **queued steering**, then coalesced into one ordinary attended follow-up when the current turn settles. Cumea atomically claims a steering batch as `dispatching` before external provider work; an ambiguous crash/reload never guesses and silently replays that batch. Routines, retries, and peer fan-out retain the one-turn guard. See [busy-user steering](docs/busy-steering.md).\n\n“Teach as routine” currently captures',
  "README steering behavior",
);
replaceOnce(
  "README.md",
  '| `server/session-freshness.ts` | private owner-local per-thread pending/dispatched/invalidated provider-session state |\n',
  '| `server/session-freshness.ts` | private owner-local per-thread pending/dispatched/invalidated provider-session state |\n| `server/busy-steering.ts` | bounded attended steering queue selection, capacity checks, and deterministic coalescing |\n',
  "README architecture",
);

replaceOnce(
  "CHANGELOG.md",
  '- Added a desktop-local per-thread Runtime inspector over the existing normalized event stream and\n  secret-redacted native protocol tee, with bounded Events/Raw lenses, expandable JSON and periodic refresh.\n',
  '- Added a desktop-local per-thread Runtime inspector over the existing normalized event stream and\n  secret-redacted native protocol tee, with bounded Events/Raw lenses, expandable JSON and periodic refresh.\n- Added attended busy-user steering on desktop and paired mobile. Explicit user messages can be queued while\n  an agent works, with visible delivery state, bounded count/text/attachment budgets and one coalesced follow-up.\n',
  "CHANGELOG Added steering",
);
replaceOnce(
  "CHANGELOG.md",
  '### Security\n\n- Session freshness metadata',
  '### Security\n\n- Busy steering uses canonical owner-local transcript state rather than a second queue. The selected batch is\n  atomically claimed as `dispatching` before external provider work; queued, dispatching and failed steering\n  rows are excluded from unrelated provider context. Ambiguous crash/reload state fails closed instead of\n  automatically replaying instructions or effects.\n- Session freshness metadata',
  "CHANGELOG Security steering",
);

for (const [path, needles] of Object.entries({
  "TODO.md": ['- [x] P0.12b —', '| 2026-08-19 | P0.12b |'],
  "README.md": ['[busy-user steering](docs/busy-steering.md)', '`server/busy-steering.ts`'],
  "CHANGELOG.md": ['Added attended busy-user steering', 'atomically claimed as `dispatching`'],
})) {
  const source = readFileSync(path, "utf8");
  for (const needle of needles) if (!source.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
