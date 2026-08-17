import { readFileSync, writeFileSync } from "node:fs";

function edit(path, replacements) {
  let text = readFileSync(path, "utf8");
  for (const [needle, replacement, label] of replacements) {
    const first = text.indexOf(needle);
    if (first < 0 || first !== text.lastIndexOf(needle)) {
      throw new Error(`${path}:${label}: expected exactly one match`);
    }
    text = `${text.slice(0, first)}${replacement}${text.slice(first + needle.length)}`;
  }
  writeFileSync(path, text);
}

edit("TODO.md", [
  [
    `- [ ] **P0.05 — Renderer update isolation.** Split the global state subscription into selectors,\n  isolate the composer and transcript, batch streaming deltas, lazy-load noncritical panels, and\n  defer expensive Markdown / syntax work until messages settle.\n`,
    `- [ ] **P0.05 — Renderer update isolation.** Split the global state subscription into selectors,\n  isolate and memoize composer/transcript boundaries, batch streaming deltas, lazy-load noncritical\n  panels, defer Markdown / syntax work until messages settle, and cache settled rendering by content\n  hash instead of re-highlighting unchanged code during every stream tick.\n`,
    "P0.05 refinement",
  ],
  [
    `- [ ] **P0.06 — Desktop conversation paging and scroll contract.** Load bounded pages, preserve the\n  reading position while prepending history, auto-follow only near the end, and expose a\n  jump-to-latest affordance without forcing scroll during selection.\n`,
    `- [ ] **P0.06 — Desktop conversation paging and scroll contract.** Load bounded pages, window long\n  transcripts, preserve the reading position while prepending history, auto-follow only near the end,\n  expose jump-to-latest / show-earlier affordances, and render very long user messages cheaply without\n  forcing scroll during selection.\n`,
    "P0.06 refinement",
  ],
  [
    `- [ ] **P0.09 — Real journey and packaged-shell tests.** Add browser journeys for onboarding, chat,\n  approvals, attachments, Needs You, routines, pairing, and computer degradation, plus packaged\n  Electron isolation and launch smoke tests.\n`,
    `- [ ] **P0.09 — Real journey and packaged-shell tests.** Add browser journeys for onboarding, chat,\n  approvals, attachments, Needs You, routines, pairing, and computer degradation, plus packaged\n  Electron isolation/launch smoke tests and retained screenshot or visual-history evidence for the\n  critical journeys.\n`,
    "P0.09 refinement",
  ],
  [
    `- [ ] **P0.10 — Mobile completion gates.** Implement push delivery for Needs You, deep-link to the\n  exact request, background reconciliation, offline/host-offline states, and physical-device\n  microphone, VoiceOver, and TalkBack acceptance evidence.\n`,
    `- [ ] **P0.10 — Mobile completion gates.** Implement push delivery for Needs You, deep-link to the\n  exact request, background reconciliation, offline/host-offline states, and physical-device\n  microphone, VoiceOver, and TalkBack acceptance evidence.\n- [ ] **P0.11 — Incremental transcript persistence and local search index.** Replace whole-thread JSON\n  rewrite amplification with a versioned owner-local SQLite/WAL message store, lazy verified legacy\n  import, per-message insert/update, rollback-aware thread deletion, bounded transcript search, and\n  export primitives without making provider-private payloads searchable by default.\n- [ ] **P0.12 — Agent liveness and loop protection.** Add activity-based stall detection with\n  waiting-on-human exemptions, honest working / waiting / no-signal / dead projections, bounded\n  repeated-identical tool/effect detection, and visible recovery through Work / Needs You rather than\n  silently killing legitimate long tasks.\n`,
    "P0.11/P0.12 insertion",
  ],
  [
    `- [ ] **P1.01 — Separate Agent, Conversation, and Memory.** Give one persistent agent multiple named,\n  archivable conversations with fresh-context creation, search, export, and durable identity.\n`,
    `- [ ] **P1.01 — Separate Agent, Conversation, and Memory.** Give one persistent agent multiple named,\n  archivable conversations with fresh-context creation, search, export, durable identity, and a global\n  keyboard navigation/search surface once P0.11 provides the local transcript index.\n`,
    "P1.01 refinement",
  ],
  [
    `- [ ] **P1.06 — Explicit memory.** Add personal, agent, project, and conversation scopes with source\n  provenance, revision history, confirmation state, priority, expiry, inspection, editing, and\n  deletion.\n`,
    `- [ ] **P1.06 — Explicit memory.** Add personal, agent, project, and conversation scopes with source\n  provenance, revision history, confirmation state, priority, expiry, inspection, editing, deletion,\n  explicit prompt-load budgets, and user-visible topic/projection views instead of opaque hidden notes.\n`,
    "P1.06 refinement",
  ],
  [
    `- [ ] **P1.11 — Unified inspector.** Replace unrelated right-side surfaces with resizable Agent, Work,\n  Computer, Apps, and Memory tabs whose state and badges remain scoped to the active agent.\n`,
    `- [ ] **P1.11 — Unified inspector.** Replace unrelated right-side surfaces with resizable Agent, Work,\n  Computer, Apps, and Memory tabs whose state and badges remain scoped to the active agent.\n- [ ] **P1.12 — Pluggable user-owned computer backends.** Put local CUA and the existing cloud-computer\n  path behind one conformance-tested backend contract, then allow optional Docker / E2B / Daytona-\n  compatible implementations without making a Cumea-managed sandbox or cloud service mandatory.\n  Model per-agent private and explicitly shared/team computers separately and report capabilities /\n  degradation honestly.\n`,
    "P1.12 insertion",
  ],
  [
    `- [ ] **P2.03 — Durable delegation DAG.** Persist dependencies, retries, checkpoints, cancellation,\n  recursion limits, child-agent ownership, and real completion evidence.\n`,
    `- [ ] **P2.03 — Durable delegation DAG.** Persist dependencies, retries, checkpoints, cancellation,\n  recursion limits, child-agent ownership, idempotent short-lived child/subagent spawn keys, per-child\n  budgets, and real completion evidence.\n`,
    "P2.03 refinement",
  ],
  [
    `- [ ] **P2.08 — Usage and budgets.** Expose per-agent, per-run, provider, model, computer, and connected-\n  app usage with configurable limits and honest unknown-cost states.\n`,
    `- [ ] **P2.08 — Usage and budgets.** Expose per-agent, per-task/run, provider, model, computer, and\n  connected-app token/usage data with configurable limits and honest unknown-cost states; require\n  child-agent work to inherit explicit budgets rather than consuming an unbounded parent allowance.\n`,
    "P2.08 refinement",
  ],
  [
    `- [ ] **P2.10 — Leased computer takeover.** Pause agent input, grant a bounded human lease, audit user\n  and agent actions separately, protect clipboard/file channels, heartbeat the lease, and recover\n  safely after disconnect.\n`,
    `- [ ] **P2.10 — Leased computer takeover.** Pause agent input, grant a bounded human lease, audit user\n  and agent actions separately, protect clipboard/file channels, heartbeat and expire the lease, and\n  recover safely after disconnect or owner/session loss.\n`,
    "P2.10 refinement",
  ],
  [
    `| 2026-08-18 | P0.04 | Replaced the desktop startup/reconnect fetch cascade with one bounded cursor-consistent bootstrap, buffered SSE reconciliation, lazy unselected-thread hydration, and deferred full Work loading when startup projections are truncated. |\n`,
    `| 2026-08-18 | P0.04 | Replaced the desktop startup/reconnect fetch cascade with one bounded cursor-consistent bootstrap, buffered SSE reconciliation, lazy unselected-thread hydration, and deferred full Work loading when startup projections are truncated. |\n| 2026-08-18 | Competitive audit | Re-audited Cumea against Rakazo \`2718b1f\` and OpenMausBot \`4a9d654\`; retained Cumea's privacy/security model while promoting transcript SQLite/search, liveness protection, renderer/thread scaling, inspectable memory, visual journey evidence, and pluggable user-owned computer backends into explicit roadmap gates. |\n`,
    "execution log",
  ],
]);

edit("README.md", [
  [
    `The immediate priorities are push/background notification delivery, signed physical-device\nacceptance, voice input on mobile, demonstrated desktop-workflow\nrecording, wider provider-tool parity, and hands-on Linux/Windows validation. The Grok-like\nthree-pane desktop model and agent-list-first mobile model remain the product direction; this work\nextends their capabilities rather than replacing either interface.\nSee [ROADMAP.md](ROADMAP.md) for the ordered backlog and\n[docs/UPSTREAM.md](docs/UPSTREAM.md) for the upstream issue/PR audit behind it.\n`,
    `The immediate engineering priorities are steady-state renderer/thread scaling, incremental local\ntranscript persistence and search, agent liveness/loop protection, signed consumer distribution,\nmobile completion gates, and wider provider/computer capability parity. These changes keep Cumea's\nno-account local-first security model and its Grok-like three-pane desktop / agent-list-first mobile\nidentity instead of replacing them with a hosted control plane.\n\nSee [ROADMAP.md](ROADMAP.md) for the ordered backlog,\n[the 2026-08-18 Rakazo/OpenMaus engineering audit](docs/competitive-audit-2026-08-18.md) for the latest\n\`adopt / adapt / reject\` decisions, and [docs/UPSTREAM.md](docs/UPSTREAM.md) for the earlier upstream\nissue/PR audit.\n`,
    "README direction",
  ],
]);

edit("CHANGELOG.md", [
  [
    `### Changed\n\n`,
    `### Changed\n\n- Re-audited current Rakazo and OpenMausBot engineering at pinned commits and folded only compatible\n  ideas into Cumea's roadmap: incremental local transcript persistence/search, liveness and loop\n  protection, renderer/thread scaling, inspectable memory, visual journey evidence, and pluggable\n  user-owned computer backends. Mandatory hosted identity/control-plane assumptions remain out of\n  scope for the local default.\n`,
    "CHANGELOG audit note",
  ],
]);
