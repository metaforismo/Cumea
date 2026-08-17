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
  - [ ] P0.01b — Add a packaged multi-sample runner with isolated first-run/returning profiles,
    explicit cache treatment, timeout/recovery behavior, and fixed-machine trend artifacts.
- [ ] **P0.02 — Operating-system secret storage.** Migrate optional desktop credentials from plaintext
  configuration to Electron `safeStorage`, keep the renderer write-only, redact diagnostics, and
  retain a tested recovery path when the OS credential store is unavailable.
- [ ] **P0.03 — Non-blocking Electron startup.** Load a packaged local renderer immediately, start the
  harness asynchronously on an OS-assigned port, replace readiness polling with an explicit parent /
  child handshake, and initialize local computer use lazily instead of blocking chat startup.
- [ ] **P0.04 — Atomic bootstrap.** Add one bounded bootstrap response for the agent index, selected
  conversation page, engine capabilities, configuration status, Needs You count, routine summary,
  computer status, and event cursor. Remove duplicate initial reloads.
- [ ] **P0.05 — Renderer update isolation.** Split the global state subscription into selectors,
  isolate the composer and transcript, batch streaming deltas, lazy-load noncritical panels, and
  defer expensive Markdown / syntax work until messages settle.
- [ ] **P0.06 — Desktop conversation paging and scroll contract.** Load bounded pages, preserve the
  reading position while prepending history, auto-follow only near the end, and expose a
  jump-to-latest affordance without forcing scroll during selection.
- [ ] **P0.07 — Bounded warm-window reuse.** On macOS, hide and retain a sanitized renderer for a short
  TTL, stop sensitive previews and streams while hidden, restore quickly from the Dock, and destroy
  the window after the TTL or on explicit quit.
- [ ] **P0.08 — Consumer desktop distribution.** Produce signed and notarized macOS artifacts, signed
  update metadata, stable / beta / nightly channels, rollback guidance, release notes in-app, and a
  Windows installer whose unsupported native capabilities fail closed.
- [ ] **P0.09 — Real journey and packaged-shell tests.** Add browser journeys for onboarding, chat,
  approvals, attachments, Needs You, routines, pairing, and computer degradation, plus packaged
  Electron isolation and launch smoke tests.
- [ ] **P0.10 — Mobile completion gates.** Implement push delivery for Needs You, deep-link to the
  exact request, background reconciliation, offline/host-offline states, and physical-device
  microphone, VoiceOver, and TalkBack acceptance evidence.

### P1 — Open-source Grok Bot product parity

- [ ] **P1.01 — Separate Agent, Conversation, and Memory.** Give one persistent agent multiple named,
  archivable conversations with fresh-context creation, search, export, and durable identity.
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
  provenance, revision history, confirmation state, priority, expiry, inspection, editing, and
  deletion.
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

### P2 — Cumea differentiation

- [ ] **P2.01 — Council Sessions.** Add a structured goal → plan → parallel work → review → approval →
  final-answer workflow distinct from casual Rooms.
- [ ] **P2.02 — Shared project memory.** Let a council work from a revisioned, inspectable project
  context without silently blending every agent's private memory.
- [ ] **P2.03 — Durable delegation DAG.** Persist dependencies, retries, checkpoints, cancellation,
  recursion limits, child-agent ownership, and real completion evidence.
- [ ] **P2.04 — Central Needs You inbox.** Aggregate approvals, questions, conflicts, expired leases,
  failed automations, and recovery actions across agents, rooms, councils, desktop, and mobile.
- [ ] **P2.05 — Review and disagreement stage.** Let agents challenge claims, attach evidence, record
  unresolved disagreement, and require the coordinator to distinguish consensus from uncertainty.
- [ ] **P2.06 — Artifact and provenance model.** Version reports, files, screenshots, decisions, source
  links, transformations, tool calls, and the run that produced each output.
- [ ] **P2.07 — Durable effect journal.** Record intent, approval, idempotency key, provider request,
  response, reconciliation, and notification so restarts cannot silently duplicate external effects.
- [ ] **P2.08 — Usage and budgets.** Expose per-agent, per-run, provider, model, computer, and connected-
  app usage with configurable limits and honest unknown-cost states.
- [ ] **P2.09 — Encrypted backup and migration.** Add inspectable encrypted export/import, schema
  migrations, recovery tests, and selective restore for agents, conversations, memories, routines,
  manifests, and artifacts.
- [ ] **P2.10 — Leased computer takeover.** Pause agent input, grant a bounded human lease, audit user
  and agent actions separately, protect clipboard/file channels, heartbeat the lease, and recover
  safely after disconnect.
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
