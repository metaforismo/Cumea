# Cumea execution plan

This file is the versioned source of truth for the work required to make Cumea a fast, private,
installable open-source alternative to Grok Bot while preserving Cumea's own product identity:

> **A council of agents. One clear voice.**

The checklist is intentionally ordered. A later item may be researched early, but implementation
should not bypass the release, security, persistence, or measurement foundations it depends on.

## Working rules

- Keep `main` protected. Work in short-lived branches and merge through focused pull requests.
- Prefer one independently reviewable concern per PR. Split large tranches before review.
- Squash-merge only after every required status check is green and review threads are resolved.
- Delete merged work branches. Do not leave abandoned replacement branches behind.
- Preserve Cumea's privacy defaults: no mandatory account, telemetry, hosted control plane, or cloud.
- Never weaken permission, origin, pairing, lifecycle, or remote-projection boundaries to ship faster.
- Treat third-party files, webhooks, model output, connected-app data, and imported manifests as
  untrusted input with explicit bounds and provenance.
- Measure performance in production builds. Do not publish benchmark claims without the commit,
  machine, operating system, sample count, median, p95, and methodology.
- Do not claim signing, notarization, store readiness, provider acceptance, or physical-device
  support until the corresponding evidence gate has actually passed.
- Update this file in the PR that completes, supersedes, splits, or blocks an item.

## Status legend

- [ ] queued
- [~] in progress
- [x] completed and merged
- [!] blocked, with the blocker recorded beside the item

## Active queue

### P0 — Fast, secure, installable foundation

- [~] **P0.00 — Triage draft PR #9.** Preserve its work, identify conflicts with current `main`, and
  split it into independently mergeable PRs for Quick agents, safe file viewers, dictation, mobile
  paging, lifecycle hardening, and release evidence. Do not merge the 124-file draft as one tranche.
- [~] **P0.01 — Desktop performance baseline and regression harness.** Add production-build timing
  marks, deterministic fixtures, JSON/Markdown reports, comparison tooling, documented metric
  definitions, and bundle-size budgets before changing startup behavior.
  - [x] P0.01a — Add opt-in cross-process timing marks, a versioned local report format,
    deterministic summary/comparison tests, documented metric semantics, and CI bundle budgets.
  - [x] P0.01b — Add an isolated packaged multi-sample runner for first-run, returning warm, and
    Chromium-cold profiles, with a deterministic no-provider fixture, explicit real-runtime mode,
    separate cache-maintenance launches, bounded logs, process-tree timeouts, manifests, and tests.
  - [ ] P0.01c — Run the packaged scenarios on one labelled fixed Mac, retain raw/summary artifacts,
    establish the first trend series, define variance-aware regression review thresholds, and keep
    hosted variable-hardware measurements informational.
- [x] **P0.02 — Operating-system secret storage.** Migrate optional desktop credentials from plaintext
  configuration to Electron `safeStorage`, keep the renderer write-only, redact diagnostics, and
  retain a tested recovery path when the OS credential store is unavailable.
  - [x] P0.02a — Add a versioned, allowlisted async `safeStorage` vault with atomic writes, key-
    rotation handling, value bounds, final-value deletion, and Linux `basic_text` rejection.
  - [x] P0.02b — Encrypt legacy plaintext before removing it; preserve a failed migration source while
    booting the packaged harness with an empty managed credential set instead of consuming it.
  - [x] P0.02c — Route packaged writes through narrow IPC, expose status/configured booleans only, and
    retain the owner-only file fallback exclusively for source/browser hosting.
  - [x] P0.02d — Bootstrap a fresh harness without a runtime secret endpoint, delete bootstrap fields
    before providers load, and roll durable/live credentials back when harness restart fails.
  - [x] P0.02e — Cover migration, corruption, unavailable storage, insecure Linux fallback, concurrent
    vault updates, key rotation, bootstrap scrubbing, successful restart, rollback, and the
    deterministic performance fixture. Physical Keychain/DPAPI/Linux acceptance remains part of
    P0.08/P0.09 release evidence rather than being inferred from source tests.
- [~] **P0.03 — Non-blocking Electron startup.** Load a packaged local renderer immediately, start the
  harness asynchronously on an OS-assigned port, replace readiness polling with an explicit parent /
  child handshake, and initialize local computer use lazily instead of blocking chat startup.
  - [x] P0.03a — Put a stable loopback desktop gateway in front of the packaged UI/API, paint the
    renderer before harness readiness, proxy SSE/API only after a verified child is available, keep
    renderer origin stable for `localStorage`, reject rebound Host values on the renderer gateway,
    and defer CUA SDK/TCC/socket work until first use.
  - [x] P0.03b — Move packaged Electron harnesses to `CUMEA_PORT=0`, publish the actual bound
    port over a versioned UtilityProcess parent/child readiness message, remove HTTP readiness polling
    and fixed private fallback ports, validate the private local listener Host/origin contract, and
    keep remote/mobile listener port semantics independent of the local ephemeral port.
  - [ ] P0.03c — Re-run matching packaged performance scenarios on the fixed-machine evidence gate and
    record startup trade-offs without attributing hosted-runner variance to the code change.
- [x] **P0.04 — Atomic bootstrap.** Add one bounded bootstrap response for the agent index, selected
  conversation page, engine capabilities, configuration status, Needs You count, bounded work/routine
  state, computer status, and event cursor. Remove duplicate initial reloads.
  - [x] P0.04a — Add the local-only bounded snapshot contract, strip provider resume cursors, and put
    one monotonic cursor on the local SSE stream with a real-harness ordering test.
  - [x] P0.04b — Replace the renderer startup/reconnect fetch cascade with one reducer hydration, a
    bounded in-flight SSE buffer, cursor-based de-duplication, overflow re-snapshot, and lazy full Work
    reload only when the startup projection was truncated.
  - [x] P0.04c — Closed the exact-head cross-platform CI/package gate, updated public docs/release
    notes, and retained squash-merge/review-thread checks as the final protected-branch gate.
- [ ] **P0.05 — Renderer update isolation.** Split the global state subscription into selectors,
  isolate and memoize composer/transcript boundaries, batch streaming deltas, lazy-load noncritical
  panels, defer Markdown / syntax work until messages settle, and cache settled rendering by content
  hash instead of re-highlighting unchanged code during every stream tick.
- [ ] **P0.06 — Desktop conversation paging and scroll contract.** Load bounded pages, window long
  transcripts, preserve the reading position while prepending history, auto-follow only near the end,
  expose jump-to-latest / show-earlier affordances, and render very long user messages cheaply without
  forcing scroll during selection.
- [ ] **P0.07 — Bounded warm-window reuse.** On macOS, hide and retain a sanitized renderer for a short
  TTL, stop sensitive previews and streams while hidden, restore quickly from the Dock, and destroy
  the window after the TTL or on explicit quit.
- [ ] **P0.08 — Consumer desktop distribution.** Produce signed and notarized macOS artifacts, signed
  update metadata, stable / beta / nightly channels, rollback guidance, release notes in-app, and a
  Windows installer whose unsupported native capabilities fail closed.
- [ ] **P0.09 — Real journey and packaged-shell tests.** Add browser journeys for onboarding, chat,
  approvals, attachments, Needs You, routines, pairing, and computer degradation, plus packaged
  Electron isolation/launch smoke tests and retained screenshot or visual-history evidence for the
  critical journeys.
- [ ] **P0.10 — Mobile completion gates.** Implement push delivery for Needs You, deep-link to the
  exact request, background reconciliation, offline/host-offline states, and physical-device
  microphone, VoiceOver, and TalkBack acceptance evidence.
- [~] **P0.11 — Incremental transcript persistence and local search index.** Replace whole-thread JSON
  rewrite amplification with a versioned owner-local SQLite/WAL message store, lazy verified legacy
  import, per-message insert/update, rollback-aware thread deletion, bounded transcript search, and
  export primitives without making provider-private payloads searchable by default.
  - [~] P0.11a — Add the owner-local derived SQLite/WAL search projection, incremental append/patch
    indexing, local-only bounded search API, privacy-safe field projection, canonical-file fingerprint
    reconciliation, secure-delete/WAL cleanup, rollback-aware bot deletion, and cross-platform handle
    lifecycle. Canonical JSON remains authoritative until P0.11b.
  - [ ] P0.11b — Migrate the canonical transcript source of truth from whole-thread JSON rewrites to
    versioned incremental SQLite with atomic verified legacy import, crash recovery, rollback-safe
    deletion, and explicit recovery/backup evidence before retiring canonical JSON writes.
  - [ ] P0.11c — Add desktop global search/navigation, exact message jumping, transcript export, and
    UX tests on top of the local index without widening the mobile/remote privacy surface.
- [ ] **P0.12 — Agent liveness and loop protection.** Add activity-based stall detection with
  waiting-on-human exemptions, honest working / waiting / no-signal / dead projections, bounded
  repeated-identical tool/effect detection, and visible recovery through Work / Needs You rather than
  silently killing legitimate long tasks.

### P1 — Open-source Grok Bot product parity

- [ ] **P1.01 — Separate Agent, Conversation, and Memory.** Give one persistent agent multiple named,
  archivable conversations with fresh-context creation, search, export, durable identity, and a global
  keyboard navigation/search surface once P0.11 provides the local transcript index.
- [ ] **P1.02 — Rooms.** Add multi-agent conversations with mentions, a default responder, everyone /
  mentions-only routing, sender attribution, a shared bulletin, reactions, approvals, and clear
  busy/waiting states.
- [ ] **P1.03 — Chief of Staff.** Allow one optional workspace coordinator to plan, delegate to the
  current roster, report real progress, consolidate disagreements, collect approvals, and return one
  final answer without inventing teammate work.
- [ ] **P1.04 — Message editing and branches.** Support edit-and-rerun, alternate branches, version
  switching, quoting, reactions, stable message links, and moving a branch into a new conversation.
- [ ] **P1.05 — Portable definitions.** Introduce bounded, versioned `.cumea-agent`, `.cumea-team`, and
  `.cumea-routine` manifests that never export transcripts, credentials, host paths, permissions, or
  internal IDs.
- [ ] **P1.06 — Explicit memory.** Add personal, agent, project, and conversation scopes with source
  provenance, revision history, confirmation state, priority, expiry, inspection, editing, deletion,
  explicit prompt-load budgets, and user-visible topic/projection views instead of opaque hidden notes.
- [ ] **P1.07 — Triggers and proactive work.** Extend routines with schedule, authenticated webhook,
  email, calendar, file-change, host-started, and previous-run-completed triggers. Keep external
  payloads visibly untrusted and effects idempotent.
- [ ] **P1.08 — Engine manager and local models.** Detect CLI candidates and versions, guide install /
  login, test overrides, display a capability matrix, and discover local model servers such as
  Ollama, LM Studio, oMLX, EXO, and compatible endpoints without pretending unsupported tools work.
- [ ] **P1.09 — User-owned always-on host.** Package an optional OCI/VPS deployment with pairing,
  HTTPS guidance, health, backup, controlled updates, device revocation, and no mandatory Cumea
  control plane.
- [ ] **P1.10 — Voice and calls.** Add safe reply playback, per-agent voices, individual calls, spoken
  progress and approval handling, interruption, and explicit platform capability reporting.
- [ ] **P1.11 — Unified inspector.** Replace unrelated right-side surfaces with resizable Agent, Work,
  Computer, Apps, and Memory tabs whose state and badges remain scoped to the active agent.
- [ ] **P1.12 — Pluggable user-owned computer backends.** Put local CUA and the existing cloud-computer
  path behind one conformance-tested backend contract, then allow optional Docker / E2B / Daytona-
  compatible implementations without making a Cumea-managed sandbox or cloud service mandatory.
  Model per-agent private and explicitly shared/team computers separately and report capabilities /
  degradation honestly.

### P2 — Cumea differentiation

- [ ] **P2.01 — Council Sessions.** Add a structured goal → plan → parallel work → review → approval →
  final-answer workflow distinct from casual Rooms.
- [ ] **P2.02 — Shared project memory.** Let a council work from a revisioned, inspectable project
  context without silently blending every agent's private memory.
- [ ] **P2.03 — Durable delegation DAG.** Persist dependencies, retries, checkpoints, cancellation,
  recursion limits, child-agent ownership, idempotent short-lived child/subagent spawn keys, per-child
  budgets, and real completion evidence.
- [ ] **P2.04 — Central Needs You inbox.** Aggregate approvals, questions, conflicts, expired leases,
  failed automations, and recovery actions across agents, rooms, councils, desktop, and mobile.
- [ ] **P2.05 — Review and disagreement stage.** Let agents challenge claims, attach evidence, record
  unresolved disagreement, and require the coordinator to distinguish consensus from uncertainty.
- [ ] **P2.06 — Artifact and provenance model.** Version reports, files, screenshots, decisions, source
  links, transformations, tool calls, and the run that produced each output.
- [ ] **P2.07 — Durable effect journal.** Record intent, approval, idempotency key, provider request,
  response, reconciliation, and notification so restarts cannot silently duplicate external effects.
- [ ] **P2.08 — Usage and budgets.** Expose per-agent, per-task/run, provider, model, computer, and
  connected-app token/usage data with configurable limits and honest unknown-cost states; require
  child-agent work to inherit explicit budgets rather than consuming an unbounded parent allowance.
- [ ] **P2.09 — Encrypted backup and migration.** Add inspectable encrypted export/import, schema
  migrations, recovery tests, and selective restore for agents, conversations, memories, routines,
  manifests, and artifacts.
- [ ] **P2.10 — Leased computer takeover.** Pause agent input, grant a bounded human lease, audit user
  and agent actions separately, protect clipboard/file channels, heartbeat and expire the lease, and
  recover safely after disconnect or owner/session loss.
- [ ] **P2.11 — Optional team/server storage.** Keep SQLite as the local default and add a separately
  tested Postgres mode only where multi-user or server operation requires it.

## Cross-cutting definition of done

Every implementation PR must include, where applicable:

- a threat-boundary note and failure/degradation behavior;
- migrations that are atomic, idempotent, and rollback-aware;
- unit or contract tests for the new invariant;
- integration or real-browser coverage for the user-visible journey;
- accessibility and reduced-motion behavior;
- Linux, Windows, macOS, mobile, and hosted capability claims limited to actual evidence;
- no secret or private provider payload in renderer state, logs, analytics, screenshots, or fixtures;
- updated documentation, release notes, and this checklist;
- all protected-branch checks green before squash merge.

## Execution log

| Date | Item | Result |
|---|---|---|
| 2026-08-17 | Planning | Created the ordered execution plan and began triage of draft PR #9. |
| 2026-08-17 | P0.01a | Added opt-in desktop timing evidence, summary/comparison tooling, tests, documentation, and CI bundle budgets without changing startup sequencing. |
| 2026-08-17 | P0.01b | Added the isolated packaged multi-sample runner, deterministic fixture, first-run/returning/cache protocols, bounded evidence, and cross-platform process tests; fixed-machine trends remain P0.01c. |
| 2026-08-17 | P0.02 | Added OS-backed packaged credential storage, fail-safe legacy migration, a write-only renderer contract, scrubbed harness bootstrap, restart rollback, and recovery tests; native signed-host acceptance remains a release gate. |
| 2026-08-17 | P0.03a | Separated renderer paint from harness readiness with a stable loopback UI/API gateway, streamed proxying, bounded unavailable states, and lazy local-computer initialization. |
| 2026-08-17 | P0.03b | Replaced packaged harness polling/fallback ports with an OS-assigned private listener and exact-PID UtilityProcess readiness message; hardened the private listener Host/origin boundary and kept remote listener ports independent. |
| 2026-08-18 | P0.04 | Replaced the desktop startup/reconnect fetch cascade with one bounded cursor-consistent bootstrap, buffered SSE reconciliation, lazy unselected-thread hydration, and deferred full Work loading when startup projections are truncated. |
| 2026-08-18 | Competitive audit | Re-audited Cumea against Rakazo `2718b1f` and OpenMausBot `4a9d654`; retained Cumea's privacy/security model while promoting transcript SQLite/search, liveness protection, renderer/thread scaling, inspectable memory, visual journey evidence, and pluggable user-owned computer backends into explicit roadmap gates. |
| 2026-08-18 | P0.11a | Began the owner-local derived transcript search index with incremental visible-message indexing, local-only bounded search, canonical-file fingerprint reconciliation, privacy-sensitive SQLite deletion semantics, and rollback-aware bot lifecycle; canonical JSON remains authoritative until P0.11b. |
