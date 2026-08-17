# Competitive engineering audit — 2026-08-18

This audit compares Cumea with two actively developed open-source agent products at fixed commits so the conclusions remain reproducible:

| Project | Audited commit | Role in this audit |
|---|---|---|
| Cumea | `286099aa5ee45bb89036005545a5524e6e4ab894` | Baseline after P0.04 atomic bootstrap |
| Rakazo | `2718b1f75a61971d104d08bda75f1f1c388851bd` | Multi-surface agent platform, sandbox/computer architecture, desktop performance evidence |
| OpenMausBot | `4a9d6540e8d621904d66718e548eee2df347ec10` | Local-first desktop product, transcript UX/persistence, memory, liveness and consumer packaging |

The goal is not feature-count parity. A competitor idea is adopted only when it improves Cumea without weakening the project's privacy defaults, local-first ownership, evidence discipline, or product identity.

## Executive result

Cumea is already stronger in several foundations that should not be traded away:

- no mandatory account, hosted control plane, telemetry, or Cumea-operated cloud;
- OS-backed packaged credential storage with write-only renderer access and rollback-aware migration;
- a stable Electron-owned loopback renderer origin in front of an API-only OS-assigned private harness;
- exact-child UtilityProcess readiness rather than port discovery polling;
- bounded cursor-consistent desktop bootstrap and narrowed authenticated mobile projection;
- transactional bot deletion that coordinates metadata and filesystem cleanup instead of treating deletion as a UI-only operation;
- a central durable Work / Needs You model rather than only transient chat state.

The largest remaining gaps are not "more agents". They are long-lived product quality and scale boundaries: incremental transcript persistence/search, long-thread rendering, renderer update isolation, explicit user-inspectable memory, liveness/loop detection, consumer distribution, and a pluggable computer backend contract.

## Decision matrix

| Area | Cumea today | Rakazo | OpenMausBot | Decision |
|---|---|---|---|---|
| Privacy / account model | Local/self-hosted by default; no account required | Web/server architecture uses auth and database services | Local-first desktop, optional network surfaces | **Keep Cumea model.** Do not introduce mandatory auth or a hosted coordinator. |
| Desktop startup | Stable gateway, OS-assigned API child, exact-PID readiness, atomic bootstrap | Bundled renderer, warm-window experiments, packaged Playwright benchmark | Local desktop packaging and smoke gates | **Adapt.** Keep Cumea startup boundary; add warm-window evidence and interaction benchmarks. |
| Performance evidence | Fixed-machine gate planned; bundle/startup tooling exists | Strong packaged benchmark: cold/warm samples, interactions, bundle compression, environment fingerprint | Practical local performance work across chat/runtime | **Adopt measurement ideas.** Never import benchmark numbers across machines. |
| Renderer updates | Global store still causes broad rerenders; P0.05 queued | Mature web component separation | `memo`, deferred work, stable transcript rendering patterns | **Adopt.** Isolate selectors, composer/transcript updates, and defer settled-only Markdown/syntax work. |
| Long transcript UX | Startup/page bounds now exist; prepend/scroll windowing still queued | Thread UI built around server-backed history | Explicit transcript windowing and "earlier" expansion patterns | **Adopt.** Complete P0.06 with windowing, anchored prepend and jump-to-latest. |
| Transcript persistence | Thread arrays cached in memory and persisted as whole JSON files | Database-backed server architecture | `node:sqlite`, WAL, incremental message insert/update, lazy legacy import | **Adopt locally.** Add SQLite/WAL without sacrificing Cumea's rollback-aware delete semantics. |
| Transcript search / navigation | Sidebar search filters bots only; `⌘K` focuses that field | Rich web navigation | Global command palette + transcript search | **Adopt after local index.** `⌘K` should become global navigation/search, not only a bot filter. |
| Message editing / branches | Not shipped; P1.04 queued | Conversation/thread model supports richer server history | Edit/rerun, versions, reactions, copy controls | **Keep P1.04, raise UX bar.** Include keyboard/IME correctness and stable links. |
| Explicit memory | Not shipped; P1.06 queued | Durable memory/context systems | User-visible editable `MEMORY.md` plus bounded topic files | **Adapt, not copy.** Cumea needs inspectable scoped memory with provenance/revisions, not one opaque file. |
| Working directory / project context | No first-class per-agent cwd contract | Computer/workspace abstraction | Per-bot working folder; live tasks pin their cwd | **Adopt concept.** Add conversation/project working context without leaking host paths through portable manifests. |
| Computer backends | Local macOS CUA + optional Box cloud computer | Docker, E2B, Daytona, desktop and fake providers behind a provider contract; team/private computers | Local/cloud computer modes | **Adapt.** Add a conformance-tested backend interface while keeping local/user-owned execution the default. |
| Human takeover | P2.10 queued | Team computer / takeover work validates shared-computer use cases | Desktop/local control surfaces | **Keep P2.10.** Require lease heartbeat, expiry, audit and clipboard/file boundaries. |
| Liveness | Busy/unread plus durable task/run status | Durable worker/runtime architecture | Activity watchdog and richer no-signal/dead/waiting states | **Adopt.** Add activity-based watchdog with waiting-on-human exemption and visible recovery state. |
| Repeated tool loops | Recursion capped for peer handoffs | Durable child/subagent lifecycle and idempotent spawn work | Repeat-call detection patterns | **Adopt bounded protection.** Detect repeated identical effects/tool calls without silently killing legitimate long work. |
| Short-lived subagents | Persistent peers + one-hop handoff today; DAG queued | Persistent bots plus short-lived subagents | Multi-agent collaboration | **Adapt into P2.03.** Child agents must have parent ownership, idempotency, budgets and completion evidence. |
| Needs You | Central Work attention tab already exists | Approval/workflow surfaces | Waiting-on-user states | **Cumea is ahead structurally.** Expand P2.04 instead of replacing it. |
| Routines / triggers | Durable routines; more triggers queued | Worker/scheduler architecture | Routines + webhook work | **Keep P1.07.** Authenticated idempotent webhooks remain a priority. |
| Voice / calls | Dictation exists; calls/reply playback queued | Mobile/desktop surfaces | Reply playback and calls | **Keep P1.10.** Preserve explicit platform capability reporting. |
| Usage / budgets | P2.08 queued | Server-side model/runtime accounting direction | Per-task token usage work | **Raise P2.08 priority.** Track provider/model/run usage before adding autonomous child-agent depth. |
| Consumer distribution | Strong evidence boundaries, unsigned package smoke; signing queued | Electron packaging and desktop testkit | Signed/notarized macOS and Windows consumer packaging work | **Adopt release maturity, not claims.** Complete P0.08 only with real signing/notarization evidence. |
| Real UI tests | Source/integration coverage; P0.09 queued | Playwright e2e and visual-history workflows | Desktop product tests | **Adopt.** Add retained screenshots/visual history for real journeys and packaged shell. |
| Storage topology | Local JSON default today; optional Postgres planned for later team mode | Postgres/Prisma central architecture | Local SQLite | **Use both where appropriate.** SQLite should become the local transcript index; Postgres stays optional team/server work, never a local prerequisite. |

## Immediate engineering priorities

### 1. Incremental transcript persistence and local search

This is the clearest current backend performance gap.

Today a message append or patch eventually rewrites a thread JSON document. That is simple and inspectable, but write amplification grows with conversation length and it makes global local search expensive. OpenMausBot demonstrates that Node's built-in SQLite can provide an owner-local WAL-backed message index without introducing a service dependency.

Cumea should implement this differently from a direct copy:

- keep the data directory user-owned and local;
- use a versioned SQLite schema and WAL;
- insert/update individual messages rather than rewriting full transcripts;
- migrate legacy JSON lazily and idempotently;
- preserve a recovery source until migration is verified;
- integrate thread deletion with Cumea's current prepare/rollback/finalize deletion model;
- expose bounded local search and export primitives without making raw provider payloads searchable by default.

Tracked as **P0.11**.

### 2. Liveness and repeated-effect protection

A durable agent UI needs to distinguish "working" from "nothing has happened for a suspiciously long time" and from "waiting for the user". A wall-clock timeout alone is wrong because a healthy long task may legitimately run for hours.

Cumea should add an activity watchdog that is reset by meaningful provider/runtime events, explicitly pauses while a pending human request exists, and surfaces recovery through Work / Needs You rather than silently terminating work. A separate repeated-effect detector should identify identical tool/effect attempts under bounded thresholds.

Tracked as **P0.12**.

### 3. Renderer and transcript scale

P0.04 removed startup overfetch; it intentionally did not solve steady-state rendering. OpenMausBot's transcript windowing and component isolation reinforce the next two existing items:

- **P0.05**: selector-based subscriptions, batching of streaming deltas, memoized transcript/composer boundaries, deferred Markdown and syntax highlighting;
- **P0.06**: bounded pages, transcript windowing, anchored prepend, near-bottom auto-follow, jump-to-latest, and inexpensive collapsed rendering for very long user messages.

### 4. Explicit memory that the user can inspect

OpenMausBot's memory editor is useful because it makes hidden durable context visible. Cumea should go further: memory must have scope, provenance, revision history, confirmation state, priority/expiry and deletion. Topic-style views can be an ergonomic projection, but the canonical model should not be a single unversioned markdown file.

This remains **P1.06**.

### 5. Pluggable user-owned computer backends

Rakazo's strongest architectural idea for Cumea is the sandbox-provider contract, not any specific hosted vendor. Cumea should define one conformance-tested computer backend interface spanning the existing local and Box paths and later optional Docker/E2B/Daytona-compatible implementations.

Requirements:

- no Cumea-managed cloud dependency;
- capability/degradation reporting per backend;
- per-agent private and explicitly shared/team computer semantics;
- bounded lifecycle, cleanup and recovery tests;
- credentials remain in the owning backend/integration boundary.

Tracked as **P1.12**.

## Smaller UI/UX improvements to fold into existing work

- promote `⌘K` from "focus bot filter" to a real command/navigation/search surface once P0.11 provides local transcript search;
- make the bot context menu a true keyboard/focus menu and expose both Mark Read and Mark Unread;
- add copy affordances, real date separators and long-user-message collapse without loading more history;
- error rows should distinguish provider setup/auth problems from retriable runtime errors;
- message-level rendering errors should degrade to bounded plain text rather than blanking the transcript;
- P1.04 edit/branch UX should be IME-safe and should never allow a stale page fetch to overwrite newer SSE state;
- P0.09 should retain screenshot/visual-history evidence for critical desktop journeys.

## Explicit non-goals from the comparison

The audit does **not** recommend:

- mandatory Better Auth / Postgres / hosted identity for local Cumea;
- a Cumea-operated managed VM or required hosted sandbox;
- weakening the OS credential boundary so browser code can read provider keys;
- replacing the stable packaged renderer origin with a random per-launch renderer port;
- copying a competitor's UI identity, terminology, assets, prompts or private implementation details;
- treating a warm-window benchmark from another project or machine as evidence that Cumea is faster.

## Review cadence

Competitive audits should be repeated only when they can change engineering decisions. Record exact source commits, merge the backlog changes through a normal PR, and require the same protected-branch gates as product code. The audit is an input to Cumea's roadmap, not an alternative roadmap.
