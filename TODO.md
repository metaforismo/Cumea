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
  paging, lifecycle hardening, and release evidence. Do not merge the historical draft as one tranche.
  - [~] P0.00a — Re-port the safe file capability boundary and Markdown/PDF/DOCX viewers from #9 onto
    current `main`, keeping attachment IDs/path resolution host-owned, MIME/size bounds explicit, and
    renderer output inert rather than executing document content.
    - [x] P0.00a1 — Extract the owner-local filesystem/capability foundation without activating routes:
      exact per-bot workspaces, host-owned attachment reads, lexical/realpath containment, regular-file
      snapshot checks, 25 MiB/file and bounded-memory capability limits, TTL/revocation, format signature
      classification, rollback-capable workspace quarantine, cross-platform tests, and a written threat boundary.
    - [x] P0.00a2a — Replace the draft's generic ZIP dependency with a dependency-free bounded semantic
      Markdown/DOCX parser: fixed ZIP central/local preflight, stored/DEFLATE only, size/entry/ratio/output
      budgets, CRC verification, active-content/external-relationship/XML-entity rejection, and a small
      heading/list/paragraph projection capped at 5,000 blocks / 2,000,000 characters.
    - [x] P0.00a2b — Activate the capability boundary through desktop-local resolve/preview/download routes:
      host-running providers receive the exact per-bot owner-local `cwd` and cite relative deliverables;
      attachments resolve only from host-owned attachment IDs; binary files are download-only; paired/mobile
      clients cannot resolve, preview, or download capabilities even with a valid bearer token; Box/cloud turns
      have the misleading host-local file instruction stripped; bot deletion stages the local workspace and
      revokes live capabilities. Prove the boundary with a real local+remote harness integration test and keep
      `FileCapabilityStore` compatible with Node 24 strip-only TypeScript execution.
    - [~] P0.00a2c — Complete the desktop safe-file viewer in separately reviewable UI/runtime/evidence gates.
      - [x] P0.00a2c1 — Add the desktop file-link/dialog surface without new runtime dependencies: replace
        ad-hoc bot Markdown with a React-node-only renderer, turn only bounded relative Markdown/PDF/DOCX
        citations and host-owned attachments into capability requests, render Markdown inertly and DOCX only
        from the bounded semantic projection, validate preview shape/size again in the renderer, trap/restore
        dialog focus, close on Escape, and keep PDF/unknown binary capabilities download-only. Tests must prove
        raw HTML stays text and traversal/absolute/file-URL paths never become file controls.
      - [ ] P0.00a2c2 — Add bounded PDF.js worker/canvas rendering with no browser plugin/iframe fallback,
        lazy-load it only when a PDF is opened, pin and review the dependency, update notices/SBOM/package
        evidence, cap pages/scale/render memory, revoke object/worker resources on close, and keep malformed /
        oversized PDFs fail-closed with download still available.
      - [ ] P0.00a2c3 — Record the exact real-browser file-viewer acceptance journey: keyboard activation of
        file citations/attachments, initial dialog focus, Tab containment, Escape close + focus restoration,
        readable text selection, reduced-motion behavior, safe error/retry/download states, and absence of
        iframe/embed/object/file:// rendering. Retain screenshot/visual evidence for the exact candidate commit.
  - [ ] P0.00b — Re-port editable native dictation from #9 as an explicit platform capability with
    permission/error states, user-editable interim text, and no silent cloud speech fallback.
  - [ ] P0.00c — Re-port the useful mobile paging/anchored-scroll/new-message work from #9 only after
    reconciling it with the current atomic bootstrap, narrowed SSE projection, and canonical SQLite.
  - [ ] P0.00d — Extract any still-useful Quick-agent, lifecycle and release-evidence work into separate
    current-main PRs; close the historical draft once every retained concern has a replacement or an
    explicit reject decision. Draft #32 is already closed as superseded; #9 is the only historical ledger.
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
  - [ ] P0.05a — Extend packaged performance evidence beyond launch: measure keydown→paint typing,
    real reducer/SSE streaming, settings paint/settle, and idle CPU/working-set memory on bounded
    transcripts. Keep runtime numbers informational until the fixed-Mac gate exists.
- [ ] **P0.06 — Desktop conversation paging and scroll contract.** Load bounded pages, window long
  transcripts, preserve the reading position while prepending history, auto-follow only near the end,
  expose jump-to-latest / show-earlier affordances, and render very long user messages cheaply without
  forcing scroll during selection.
  - [ ] P0.06a — Window mounted transcript rows independently from server paging, preserve an anchor
    across prepend and search-window transitions, and prove selection/copy and near-bottom auto-follow
    behavior on long threads before increasing default page sizes.
- [ ] **P0.07 — Bounded warm-window reuse.** On macOS, hide and retain a sanitized renderer for a short
  TTL, stop sensitive previews and streams while hidden, restore quickly from the Dock, and destroy
  the window after the TTL or on explicit quit.
- [ ] **P0.08 — Consumer desktop distribution.** Produce signed and notarized macOS artifacts, signed
  update metadata, stable / beta / nightly channels, rollback guidance, release notes in-app, and a
  Windows installer whose unsupported native capabilities fail closed.
  - [x] P0.08a — Verify the complete staged server runtime closure. The desktop harness and every
    classified `*-proxy` sidecar must exist under `Resources/server`; reachable literal relative
    imports are followed transitively; new source proxies must be explicitly classified; and mutation
    tests fail on omitted entrypoints/dependencies, path escape, non-literal loading, or bare package
    imports under the current no-runtime-`node_modules` contract. Signed sidecar execution remains
    part of P0.08/P0.09 rather than being inferred from this structure gate.
- [ ] **P0.09 — Real journey and packaged-shell tests.** Add browser journeys for onboarding, chat,
  approvals, attachments, Needs You, routines, pairing, and computer degradation, plus packaged
  Electron isolation/launch smoke tests and retained screenshot or visual-history evidence for the
  critical journeys.
  - [~] P0.09a — Add an app-wide keyboard/focus/selection/reduced-motion baseline and acceptance journey:
    visible `:focus-visible` state without pointer-only rings, brand selection styling, and reduced-motion
    handling for panel/pop/scroll transitions while semantic busy indicators remain truthful.
    - [x] P0.09a1 — Land the app-wide interaction stylesheet after component styles, covering native and
      custom keyboard-focusable controls, brand text selection, smooth-scroll suppression, decorative
      panel/pop animation removal, and near-zero transition timing without hiding semantic activity state.
      Keep the baseline under a source-level contract test so later UI refactors cannot silently drop it.
    - [ ] P0.09a2 — Record the real-browser acceptance journey: pointer interactions must not gain noisy
      rings, keyboard navigation must retain visible focus across the shell/custom controls, text selection
      must remain readable, and reduced-motion must suppress panel/pop/scroll motion while busy/waiting
      state stays understandable. Retain screenshot/visual evidence with the exact candidate commit.
- [ ] **P0.10 — Mobile completion gates.** Implement push delivery for Needs You, deep-link to the
  exact request, background reconciliation, offline/host-offline states, and physical-device
  microphone, VoiceOver, and TalkBack acceptance evidence.
  - [ ] P0.10a — Add optional same-LAN Bonjour/mDNS discovery **before** cryptographic pairing, rank
    real interfaces ahead of tunnels/bridges, advertise per interface, re-advertise/withdraw on network
    changes, and return a bounded ordered host-candidate list at pairing. The client rotates only on
    transport/address failures (never 401), persists the working candidate, supports manual address
    edits without losing the device token, and keeps discovery metadata strictly non-authenticating.
  - [ ] P0.10b — Add native Needs You notifications that open the exact request, reconcile current host
    state before showing actions, and never let a stale notification approve an already-resolved ask.
- [x] **P0.11 — Incremental transcript persistence and local search index.** Replace whole-thread JSON
  rewrite amplification with a versioned owner-local SQLite/WAL message store, lazy verified legacy
  import, per-message insert/update, rollback-aware thread deletion, bounded transcript search, and
  export primitives without making provider-private payloads searchable by default.
  - [x] P0.11a — Add the owner-local derived SQLite/WAL search projection, incremental append/patch
    indexing, local-only bounded search API, privacy-safe field projection, canonical-file fingerprint
    reconciliation, secure-delete/WAL cleanup, rollback-aware bot deletion, and cross-platform handle
    lifecycle. Canonical JSON remains authoritative until P0.11b.
  - [x] P0.11b — Migrate the canonical transcript source of truth from whole-thread JSON rewrites to
    versioned incremental SQLite with atomic verified legacy import, crash recovery, rollback-safe
    deletion, and explicit recovery/backup evidence before retiring canonical JSON writes.
    - [x] P0.11b1 — Add the owner-local `transcripts.sqlite` schema, all-or-nothing validated/hash-
      attributed legacy import, stable ordering, revisions, incremental mutation primitives,
      reversible pending-delete state, crash reconciliation, backup primitive, and cross-platform tests.
    - [x] P0.11b2 — Wire a guarded Store cutover backend that imports owned threads fail-closed,
      reads/appends/patches canonical SQLite without whole-thread JSON rewrites, reconciles the derived
      search index against canonical revisions, preserves existing legacy JSON as a recovery anchor,
      and fails bot deletion closed until the b3 transaction is available.
    - [x] P0.11b3 — Integrate canonical pending-delete recovery with the real HTTP bot deletion path,
      prove crash/restart and post-COMMIT privacy cleanup windows, enable the canonical Store backend in
      production, preserve immutable legacy migration anchors without rewriting them, remove them on bot
      deletion, and retain tested local backup/recovery primitives.
  - [x] P0.11c — Integrate visible transcript hits into the existing desktop search field, load bounded
    exact-message windows instead of whole threads, highlight and return to latest, add bounded Markdown/JSON
    visible-transcript export, and keep exact navigation/export off the mobile/remote surface.
- [x] **P0.12 — Agent lifecycle correctness, liveness and loop protection.** Make long-running work
  observable and recoverable without losing explicit user steering or trusting stale provider sessions.
  - [x] P0.12a — Add activity-based stall detection with waiting-on-human exemptions, honest working /
    waiting / no-signal / dead projections, bounded repeated-identical tool/effect detection, and visible
    recovery through Work / Needs You rather than silently killing legitimate long tasks.
  - [x] P0.12b — Persist explicit user messages sent while a bot is busy, mark them visibly queued, bound
    count/bytes, and drain/coalesce them into one attended follow-up turn on settlement with explicit
    stop/restart semantics. Do not apply this queue implicitly to routines or peer fan-out.
  - [x] P0.12c — Add dispatch-based engine/session freshness. Record which provider instance last ran the
    thread/task, rebuild bounded canonical context whenever the selected instance is stale, and never
    trust an old resume cursor across A→B→A or provider-reload transitions.

### P1 — Open-source Grok Bot product parity

- [ ] **P1.01 — Separate Agent, Conversation, and Memory.** Give one persistent agent multiple named,
  archivable conversations with fresh-context creation, search, export, durable identity, and a global
  keyboard navigation/search surface once P0.11 provides the local transcript index.
  - [ ] P1.01a — Add New conversation / archive / clear-conversation semantics without deleting the
    agent identity, its settings or its memories. Destructive clear must target one conversation and
    retain export/recovery confirmation rather than being the only way to get fresh context.
- [ ] **P1.02 — Rooms.** Add multi-agent conversations with mentions, a default responder, everyone /
  mentions-only routing, sender attribution, a shared bulletin, reactions, approvals, clear busy/waiting
  states, and an optional explicitly shared working folder/computer distinct from private agent state.
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
  - [ ] P1.06a — Add owner-local bounded history compaction: summarize old canonical batches with
    provenance/cursors and time/input limits, never advance on failed/empty summaries, shrink verbatim
    history only after recall succeeds, mark recalled material as possibly stale data, and allow optional
    external memory adapters only after the local contract is complete.
- [ ] **P1.07 — Triggers and proactive work.** Extend routines with schedule, authenticated webhook,
  email, calendar, file-change, host-started, and previous-run-completed triggers. Keep external
  payloads visibly untrusted and effects idempotent.
  - [ ] P1.07a — Add trusted in-chat connector authorization/continuation: when a tool discovers a missing
    connection, Cumea—not model output—creates the bounded auth card/validated HTTPS URL, reconciles
    completion, and resumes the original task without exposing credentials in the transcript.
- [ ] **P1.08 — Engine manager and local models.** Detect CLI candidates and versions, guide install /
  login, test overrides, display a capability matrix, and discover local model servers such as
  Ollama, LM Studio, oMLX, EXO, and compatible endpoints without pretending unsupported tools work.
  - [ ] P1.08a — Add guided provider install/login and official device-code/subscription authentication
    where supported, with clear distinction between CLI subscription auth and API-key billing.
  - [x] P1.08b — Extend the verified provider capability matrix to Codex peer handoff: mount the existing
    harness-owned agents stdio MCP contract through app-server `-c` configuration, advertise the capability
    only after the mount exists, and prove the per-boot comms secret stays in child env rather than argv.
    Keep Codex connected-app support separate until its HTTP/remote transport contract has an independent
    protocol-level test instead of inferring support from the generic MCP mechanism.
  - [x] P1.08c — Extend verified Codex parity to computer tools: mount the already-validated Electron-owned
    local CUA stdio spawn contract when present, mount Box cloud computer use through the existing
    release-classified `computer-proxy` sidecar, expose local/cloud capability bits only after those mounts
    exist, and prove local-daemon / Box credential values stay in child env rather than app-server argv.
    Do not infer Linux local-control support from this portable driver path; current Cumea local CUA evidence
    remains macOS-only until the separately tracked Linux release/native-control gates are actually proven.
- [ ] **P1.09 — User-owned always-on host.** Package an optional OCI/VPS deployment with pairing,
  HTTPS guidance, health, backup, controlled updates, device revocation, and no mandatory Cumea
  control plane.
- [ ] **P1.10 — Voice and calls.** Add safe reply playback, per-agent voices, individual calls, spoken
  progress and approval handling, interruption, and explicit platform capability reporting.
- [ ] **P1.11 — Unified inspector.** Replace unrelated right-side surfaces with resizable Agent, Work,
  Computer, Apps, Memory and Diagnostics tabs whose state/badges remain scoped to the active agent.
  - [x] P1.11a — Add a desktop-local per-thread **Events / Raw** diagnostics lens over existing `events/`
    and secret-redacted `native/` NDJSON: bounded tail reads, independent stream caps, torn-line tolerance,
    schema validation, folded delta summaries, expandable JSON, live/settled refresh, and no mobile exposure.
- [ ] **P1.12 — Pluggable user-owned computer backends.** Put local CUA and the existing cloud-computer
  path behind one conformance-tested backend contract, then allow optional Docker / E2B / Daytona-
  compatible implementations without making a Cumea-managed sandbox or cloud service mandatory.
  Model per-agent private and explicitly shared/team computers separately and report capabilities /
  degradation honestly.
  - [ ] P1.12a — Add the backend conformance suite and a user-owned BYO-VPS implementation using a
    preconfigured SSH alias / Docker transport: no app-stored private key, no auto-accepted host key,
    no public container ports, explicit transport-vs-missing states, bounded status/lock timeouts,
    hardened managed-container verification, disposable-filesystem copy, and no SSH alias on mobile.
  - [ ] P1.12b — Add explicit Team/Project computer scope distinct from Private agent computers. Shared
    files and graphical-session capability are separate; each run gets a fenced display/session lease,
    stale claims are rejected, and completion/rollback/takeover release the exact lease deterministically.
  - [ ] P1.12c — After the generic backend contract is stable, evaluate an explicitly paired user-owned
    phone/device backend (for example USB Android) as an agent computer. Keep it separate from the
    companion control surface and require the same capability/permission/lease evidence as other backends.

### P2 — Cumea differentiation

- [ ] **P2.01 — Council Sessions.** Add a structured goal → plan → parallel work → review → approval →
  final-answer workflow distinct from casual Rooms.
- [ ] **P2.02 — Shared project memory.** Let a council work from a revisioned, inspectable project
  context without silently blending every agent's private memory.
- [ ] **P2.03 — Durable delegation DAG.** Persist dependencies, retries, checkpoints, cancellation,
  recursion limits, child-agent ownership, idempotent short-lived child/subagent spawn keys, per-child
  concurrency/depth/token/cost/output budgets, and real completion evidence.
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
  recover safely after disconnect or owner/session loss. Keep paired mobile computer access read-only
  until this lease boundary is implemented and tested.
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
| 2026-08-18 | P0.11a | Completed the owner-local derived transcript search index with incremental visible-message indexing, local-only bounded search, canonical-file fingerprint reconciliation, cache-cold HTTP rollback evidence, privacy-sensitive SQLite deletion semantics, and cross-platform handle cleanup; canonical JSON remains authoritative until P0.11b. |
| 2026-08-18 | P0.11b1 | Completed the versioned canonical transcript SQLite foundation with verified legacy import, stable ordering/revisions, incremental mutation primitives, reversible pending deletion, crash reconciliation, independently readable local backups, and cross-platform CI; production Store cutover remains P0.11b2. |
| 2026-08-18 | P0.11b2 | Completed the guarded Store cutover backend with verified legacy import, SQLite-only incremental appends/patches, canonical-revision search reconciliation, restart/crash evidence, no new whole-thread JSON files, and fail-closed deletion until b3; the real harness remains legacy-backed until b3 enables it. |
| 2026-08-18 | P0.11b3 | Activated canonical transcript SQLite in the real harness with rollback-capable post-COMMIT deletion, pending-delete restart recovery, canonical/search/metadata/file rollback evidence, immutable legacy migration anchors, canonical-only new threads, and cross-platform CI. |
| 2026-08-18 | P0.11c | Completed global desktop transcript search/navigation and bounded visible export on the local index, with exact-focus windows, Return to latest, export redaction, paired-remote denial, and cross-platform CI. P0.11 is complete. |
| 2026-08-18 | Competitive audit refresh | Re-pinned Cumea `4b897646`, Rakazo `9622c388`, and OpenMausBot `e7d71f4b`; promoted raw diagnostics, draft-#9 extraction, app-wide accessibility, session freshness, busy steering, package spawn closure, connector continuation, mobile discovery/notifications, provider onboarding, and bounded subagents into explicit gates without weakening the local/privacy model. |
| 2026-08-18 | P1.11a | Added a desktop-local bounded Runtime inspector over existing normalized and secret-redacted native thread logs, with Events/Raw lenses, payload clipping, torn-line tolerance, real-harness local/no-store evidence, authenticated mobile denial, and right-slot UI integration. |
| 2026-08-18 | P0.12c | Added dispatch-based native-session freshness with private per-thread pending/dispatched/invalidated state, A→B→A and unsupported-model rebuilds, provider-reload invalidation, bounded canonical context, shared native cursor refusal, successful-turn confirmation, and fake-Claude rebuild evidence. |
| 2026-08-19 | P0.12b | Added bounded attended busy-user steering with canonical queued/dispatching/failed delivery state, one-follow-up coalescing, atomic batch claims, at-most-once crash/reload behavior, desktop/mobile Stop+Send controls, and real-harness recovery/no-duplication evidence. |
| 2026-08-19 | P0.12a | Added activity-based lifecycle projections, explicit waiting-on-human exemption, advisory no-signal/dead recovery, bounded repeated-effect detection, provider-vs-lifecycle attention ownership, semantic-only Workspace persistence, and Work/Needs You recovery UX. P0.12 is complete. |
| 2026-08-19 | Competitive audit | Re-pinned Cumea `ea3d751b`, Rakazo `c3d386d8`, and OpenMausBot `70805c0a`; promoted conversation separation, local history compaction, steady-state renderer evidence, resilient companion candidate rotation, BYO-VPS, and fenced Team/Private computer semantics without adopting mandatory hosted identity/control-plane assumptions. |
| 2026-08-19 | P0.09a1 | Added the app-wide keyboard-focus/selection/reduced-motion interaction baseline after component styles and a contract test that preserves custom-control focus coverage and non-semantic motion suppression; the real-browser acceptance journey remains P0.09a2. |
| 2026-08-19 | P0.08a | Added the release-critical harness/sidecar manifest, source-proxy drift detection, staged-package transitive import closure, cross-platform mutation tests, and release documentation. Actual signed sidecar execution remains a P0.08/P0.09 evidence gate. |
| 2026-08-19 | P0.00a1 | Extracted the safe owner-local file capability/workspace foundation from draft #9 with bounded snapshots, no host-path projection, expiry/revocation, signature checks, delete quarantine rollback, cross-platform tests, and a written security contract. HTTP/UI/PDF/DOCX activation remains P0.00a2. |
| 2026-08-19 | P0.00a2a | Replaced the draft's JSZip DOCX path with a dependency-free bounded central-directory/DEFLATE/CRC/XML semantic parser and adversarial tests; routes, renderer and PDF.js remain separate gates. |
| 2026-08-19 | Draft cleanup | Closed superseded safe-file draft #32 without merge; #9 remains the sole historical extraction ledger until the remaining retained concerns have replacement PRs or reject decisions. |
| 2026-08-20 | P0.00a2b | Activated desktop-local opaque file capability routes with host-owned attachment resolution, host-provider workspaces, binary download-only behavior, explicit Box/cloud filesystem separation, paired/mobile denial, delete-time capability revocation and real-harness cross-platform evidence. The integration pass also exposed and fixed the P0.00a1 Node 24 strip-only constructor incompatibility instead of hiding it behind the test harness. |
| 2026-08-20 | P0.00a2c1 | Added safe desktop Markdown/DOCX file-link and attachment preview UI over opaque local capabilities, renderer-side projection bounds, dialog keyboard/focus semantics, raw-HTML/path traversal rejection, and explicit PDF/binary download-only degradation pending the PDF.js and browser-journey gates. |
| 2026-08-20 | P1.08b | Enabled Codex peer-agent handoff through the existing harness-owned agents MCP contract, with capability advertisement only after mounting exists and a fake app-server test proving the per-boot comms token never appears as an argv value. |
| 2026-08-20 | P1.08c | Enabled Codex local CUA and cloud Box computer tools through the existing verified stdio/proxy contracts, with capability bits, package-closure reuse, and fake app-server evidence that local/Box secret values remain outside argv. |