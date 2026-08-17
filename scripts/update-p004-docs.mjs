import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const before = readFileSync(path, "utf8");
  const first = before.indexOf(needle);
  if (first < 0 || first !== before.lastIndexOf(needle)) {
    throw new Error(`${label}: expected exactly one match`);
  }
  writeFileSync(path, `${before.slice(0, first)}${replacement}${before.slice(first + needle.length)}`);
}

replaceOnce(
  "README.md",
  `Mobile does not run providers on the phone and Cumea does not supply a managed VM. For work to\ncontinue after a laptop is closed, the user must keep the same Cumea harness running on an\nauthenticated machine they control. The mobile client consumes a narrowed authenticated SSE stream,\nreconciles a fresh bootstrap snapshot after each connection, pauses in the background, and reconnects\nunexpected closures with bounded backoff.\n`,
  `Mobile does not run providers on the phone and Cumea does not supply a managed VM. For work to\ncontinue after a laptop is closed, the user must keep the same Cumea harness running on an\nauthenticated machine they control. The mobile client consumes a narrowed authenticated SSE stream,\nreconciles a fresh bootstrap snapshot after each connection, pauses in the background, and reconnects\nunexpected closures with bounded backoff.\n\nThe desktop uses a separate local-only bootstrap contract: one bounded snapshot carries the agent\nindex, selected transcript page, engine/configuration status, workspace projection, Needs You count,\nand a monotonic event cursor. SSE is opened first and buffered during the snapshot cut, so reconnects\ncan discard already-represented events instead of re-running four independent startup fetches. See\n[desktop bootstrap consistency](docs/desktop-bootstrap.md).\n`,
  "README desktop bootstrap paragraph",
);

replaceOnce(
  "TODO.md",
  `- [ ] **P0.04 — Atomic bootstrap.** Add one bounded bootstrap response for the agent index, selected\n  conversation page, engine capabilities, configuration status, Needs You count, routine summary,\n  computer status, and event cursor. Remove duplicate initial reloads.\n`,
  `- [~] **P0.04 — Atomic bootstrap.** Add one bounded bootstrap response for the agent index, selected\n  conversation page, engine capabilities, configuration status, Needs You count, bounded work/routine\n  state, computer status, and event cursor. Remove duplicate initial reloads.\n  - [x] P0.04a — Add the local-only bounded snapshot contract, strip provider resume cursors, and put\n    one monotonic cursor on the local SSE stream with a real-harness ordering test.\n  - [x] P0.04b — Replace the renderer startup/reconnect fetch cascade with one reducer hydration, a\n    bounded in-flight SSE buffer, cursor-based de-duplication, overflow re-snapshot, and lazy full Work\n    reload only when the startup projection was truncated.\n  - [ ] P0.04c — Close the exact-head cross-platform CI/package gate, update public docs/release notes,\n    and squash merge only after review threads are clear.\n`,
  "TODO P0.04 breakdown",
);

replaceOnce(
  "CHANGELOG.md",
  `- Local computer initialization is now lazy: normal startup writes a harmless unavailable descriptor\n  without loading the CUA SDK, reading TCC state, probing the local socket, or starting the native\n  daemon. Actual reconciliation happens when the capability is inspected or requested.\n`,
  `- Local computer initialization is now lazy: normal startup writes a harmless unavailable descriptor\n  without loading the CUA SDK, reading TCC state, probing the local socket, or starting the native\n  daemon. Actual reconciliation happens when the capability is inspected or requested.\n- Desktop state now has a versioned, bounded local bootstrap snapshot with a monotonic SSE cursor.\n  Startup and reconnect buffer concurrent deltas, hydrate bots/configuration/engines/work state once,\n  discard events already represented by the snapshot, and re-snapshot rather than guessing after a\n  bounded-buffer overflow.\n`,
  "CHANGELOG P0.04 added",
);
