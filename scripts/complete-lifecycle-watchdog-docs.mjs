import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

replaceOnce(
  "TODO.md",
  '- [ ] **P0.12 — Agent lifecycle correctness, liveness and loop protection.**',
  '- [x] **P0.12 — Agent lifecycle correctness, liveness and loop protection.**',
  "P0.12 parent status",
);
replaceOnce(
  "TODO.md",
  '  - [ ] P0.12a — Add activity-based stall detection with waiting-on-human exemptions, honest working /\n',
  '  - [x] P0.12a — Add activity-based stall detection with waiting-on-human exemptions, honest working /\n',
  "P0.12a status",
);
replaceOnce(
  "TODO.md",
  '| 2026-08-19 | P0.12b | Added bounded attended busy-user steering with canonical queued/dispatching/failed delivery state, one-follow-up coalescing, atomic batch claims, at-most-once crash/reload behavior, desktop/mobile Stop+Send controls, and real-harness recovery/no-duplication evidence. |',
  '| 2026-08-19 | P0.12b | Added bounded attended busy-user steering with canonical queued/dispatching/failed delivery state, one-follow-up coalescing, atomic batch claims, at-most-once crash/reload behavior, desktop/mobile Stop+Send controls, and real-harness recovery/no-duplication evidence. |\n| 2026-08-19 | P0.12a | Added activity-based lifecycle projections, explicit waiting-on-human exemption, advisory no-signal/dead recovery, bounded repeated-effect detection, provider-vs-lifecycle attention ownership, semantic-only Workspace persistence, and Work/Needs You recovery UX. P0.12 is complete. |',
  "P0.12a execution log",
);

replaceOnce(
  "README.md",
  '- attended busy-user steering: send additional direction while an agent is working, with a bounded durable queue and one coalesced follow-up turn.\n',
  '- attended busy-user steering: send additional direction while an agent is working, with a bounded durable queue and one coalesced follow-up turn;\n- lifecycle-aware Work status with explicit working / waiting / no-signal / dead projections and advisory repeated-action recovery instead of timer-based auto-kill.\n',
  "README lifecycle feature",
);
replaceOnce(
  "README.md",
  'While an agent is already working, desktop and paired mobile keep the composer usable. Explicit user messages are persisted immediately as bounded **queued steering**, then coalesced into one ordinary attended follow-up when the current turn settles. Cumea atomically claims a steering batch as `dispatching` before external provider work; an ambiguous crash/reload never guesses and silently replays that batch. Routines, retries, and peer fan-out retain the one-turn guard. See [busy-user steering](docs/busy-steering.md).\n\n“Teach as routine” currently captures',
  'While an agent is already working, desktop and paired mobile keep the composer usable. Explicit user messages are persisted immediately as bounded **queued steering**, then coalesced into one ordinary attended follow-up when the current turn settles. Cumea atomically claims a steering batch as `dispatching` before external provider work; an ambiguous crash/reload never guesses and silently replays that batch. Routines, retries, and peer fan-out retain the one-turn guard. See [busy-user steering](docs/busy-steering.md).\n\nTracked Work runs now expose honest lifecycle state. Provider questions/approvals are explicitly `waiting` and exempt from silence timers; `no-signal` / `dead` are advisory observations and never auto-kill a provider. Repeated-identical tool/effect sequences surface through Work / Needs You so the user can steer or stop the current turn. See [agent lifecycle watchdog](docs/agent-lifecycle.md).\n\n“Teach as routine” currently captures',
  "README lifecycle behavior",
);
replaceOnce(
  "README.md",
  '| `server/busy-steering.ts` | bounded attended steering queue selection, capacity checks, and deterministic coalescing |\n',
  '| `server/busy-steering.ts` | bounded attended steering queue selection, capacity checks, and deterministic coalescing |\n| `server/lifecycle-watchdog.ts` | bounded process-local activity state machine for Work liveness, waiting exemptions, and repeated-effect alerts |\n',
  "README lifecycle architecture",
);

replaceOnce(
  "CHANGELOG.md",
  '- Added attended busy-user steering on desktop and paired mobile. Explicit user messages can be queued while\n  an agent works, with visible delivery state, bounded count/text/attachment budgets and one coalesced follow-up.\n',
  '- Added attended busy-user steering on desktop and paired mobile. Explicit user messages can be queued while\n  an agent works, with visible delivery state, bounded count/text/attachment budgets and one coalesced follow-up.\n- Added lifecycle-aware Work projections (`working`, `waiting`, `no-signal`, `dead`) with waiting-on-human\n  exemptions, bounded repeated-identical effect alerts and visible recovery in Work / Needs You.\n',
  "CHANGELOG Added lifecycle",
);
replaceOnce(
  "CHANGELOG.md",
  '### Security\n\n- Busy steering uses canonical owner-local transcript state',
  '### Security\n\n- Lifecycle detection is advisory and never kills a provider solely because a timer elapsed. Real provider\n  approvals/questions own a separate attention state and are exempt from silence/dead thresholds; ordinary\n  heartbeats stay process-local so the watchdog does not amplify durable Workspace writes.\n- Busy steering uses canonical owner-local transcript state',
  "CHANGELOG lifecycle safety",
);

for (const [path, needles] of Object.entries({
  "TODO.md": ['- [x] **P0.12 —', '- [x] P0.12a —', '| 2026-08-19 | P0.12a |'],
  "README.md": ['[agent lifecycle watchdog](docs/agent-lifecycle.md)', '`server/lifecycle-watchdog.ts`'],
  "CHANGELOG.md": ['Added lifecycle-aware Work projections', 'Lifecycle detection is advisory'],
})) {
  const source = readFileSync(path, "utf8");
  for (const needle of needles) if (!source.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
