# Competitive engineering audit — 2026-08-18 refresh

This audit compares Cumea with two actively developed open-source agent products at fixed commits so every conclusion can be reproduced later.

| Project | Audited commit | Role in this audit |
|---|---|---|
| Cumea | `4b897646797caa59f47459910c9a2482a5d2c194` | Baseline after P0.11 canonical transcript persistence, local search, exact navigation, and bounded export |
| Rakazo | `9622c38825decd1bb41390c8176491efb030c0a1` | Multi-surface agent platform, sandbox/provider abstraction, subagents, provider onboarding, visual E2E, desktop performance work |
| OpenMausBot | `e7d71f4b7030904156337f511c31bab2115d9e5b` | Local-first desktop/mobile product, raw-event inspector, connector continuation, busy steering, engine freshness, voice and consumer release work |

The goal is not feature-count parity. A competitor idea is adopted only when it improves Cumea without weakening local ownership, privacy defaults, least-privilege remote access, evidence discipline, or Cumea's own product identity.

## Executive result

The largest change since the previous audit is that transcript persistence/search is no longer a Cumea gap. Cumea now has a stronger local persistence/privacy boundary than either comparison requires for its own architecture:

- `transcripts.sqlite` is the canonical folded transcript source with incremental append/patch and verified legacy import;
- `message-search.sqlite` is a separate derived index reconciled by canonical revisions;
- exact search navigation loads a bounded window around one message instead of an entire long thread;
- local Markdown/JSON export projects visible transcript data only;
- bot deletion remains rollback-capable even after canonical SQLite DELETE has committed and privacy-checkpointed;
- packaged optional secrets are OS-backed and write-only to the renderer;
- desktop bootstrap is one cursor-consistent bounded snapshot behind a stable Electron-owned loopback origin;
- the paired mobile surface remains an explicitly narrower projection rather than a second full-trust desktop API.

The highest-value gaps have therefore moved upward into **observability, steady-state performance, interaction semantics, mobile completion, provider lifecycle, and consumer release maturity**.

## Current decision matrix

| Area | Cumea at audited commit | Rakazo | OpenMausBot | Decision |
|---|---|---|---|---|
| Privacy / identity | No mandatory account, telemetry, hosted coordinator, or Cumea cloud | Better Auth + Postgres/server architecture supports hosted/multi-user use | Local-first desktop, optional companion/network surfaces | **Keep Cumea model.** Hosted identity remains optional future server work, never a local prerequisite. |
| Secret storage | Packaged credentials use OS-backed Electron vault and renderer sees status only | Deployment/user credential model appropriate to server topology | Local settings and provider credentials | **Keep Cumea boundary.** Do not trade it for easier browser-readable keys. |
| Canonical transcripts | Incremental owner-local SQLite/WAL, verified import, revisions, rollback-safe delete | Postgres-backed server persistence | Local persistence and long-lived thread work | **Cumea foundation is now strong.** Optimize/UI-build on top; do not reopen format churn without evidence. |
| Search / navigation | Local derived index, global desktop message search, exact bounded jump, redacted export | Server navigation/search patterns | Rich conversation navigation patterns | **Keep and extend.** P1.01 can reuse this foundation for multiple conversations per agent. |
| Startup | Stable packaged renderer gateway, OS-assigned private harness, exact-child readiness, atomic bootstrap | Bundled renderer, aggregated bootstrap, warm-window reuse, timing instrumentation | Embedded harness and released desktop builds | **Adapt Rakazo measurement/warm reuse only after fixed-machine evidence.** Preserve Cumea's trust boundary. |
| Steady-state renderer | Global reducer/store still causes broad subscriptions and streaming work | Mature web separation and interaction-performance work | Memo/deferred/render-isolation improvements | **Adopt.** P0.05 remains one of the highest performance priorities. |
| Long threads | Server paging/search windows exist; normal desktop transcript still lacks full anchored windowing contract | Server-backed history | Mature long-thread UX patterns | **Adopt.** Complete P0.06: anchored prepend, near-bottom follow, windowing, cheap long-message rendering. |
| Busy-agent steering | `startTurn` returns 409 when `bot.busy` | Durable worker model | Persists user steering messages and drains them into one attended follow-up turn | **Adopt carefully.** Queue only explicit user steering, make state visible, bound it, and define restart semantics. |
| Engine switching | Per-instance resume cursors are durable, but a previously used instance can be resumed after another engine ran | Model/runtime management is workspace-aware | Tracks last dispatched instance and rebuilds context when an engine is stale | **Adopt.** Add dispatch-based session freshness; never trust an old cursor across A→B→A. |
| Runtime inspector | Durable `events/` and redacted `native/` logs exist, but require manual inspection | Operational/server observability | Per-thread Events + Raw inspector reads existing logs, bounded and expandable | **Adopt first.** This is a high-value, low-architecture-change P1.11a tranche. |
| Error diagnosis | Activity chips + Work runs expose failures but not the wire-level cause | Server/runtime diagnostics | Inspector distinguishes normalized events from provider-native traffic | **Adapt.** Keep raw/native material local-only and redacted; never send it to companion/mobile. |
| Connected apps | Composio marketplace and browser auth links exist; agent-requested missing auth is not a first-class continuation | Composio catalog with deterministic E2E emulation | MCP proxy converts connection requests into secure chat cards and resumes work after auth | **Adopt flow, not implementation.** Cumea should own auth URLs/cards and continuation; model output must never author trusted auth links. |
| Provider onboarding | Engine/model picker and configured-state surfaces; CLI install/login remains manual | Device-code/subscription flows for ChatGPT, Copilot, xAI plus model management | Local CLI discovery/auth model | **Adapt.** Add guided install/login and device-code subscription paths where providers officially support them. |
| Explicit memory | P1.06 queued | Durable memory/context architecture | User-visible local memory work | **Adapt.** Cumea should use scoped, revisioned, provenance-bearing memory rather than one opaque markdown file. |
| Persistent peers | Agent-to-agent handoff with recursion cap | Bots can spawn durable peers | Rooms/collaboration paths | **Keep and extend.** Do not collapse durable peers and ephemeral subagents into one concept. |
| Short-lived subagents | Not shipped; P2.03 describes durable delegation ownership/budgets | Short-lived subagents inside a turn | Multi-agent/collaboration work | **Adopt with hard bounds.** Concurrency, depth, output, token/cost and cancellation budgets are mandatory before autonomy depth. |
| Rooms/shared work | Rooms queued; no shared room working-folder contract yet | Shared Team Computer + private computer concepts | Rooms can pin a shared working folder | **Adapt later.** Shared folder/computer ownership belongs with P1.02/P1.12 and must not leak host paths into portable definitions. |
| Routines | Durable schedules, manual run, Work audit | Full edit/delete/run UI and worker stack | Routines + webhook triggers | **Improve UX and triggers.** Editing/deleting/running should be obvious and stale-editor state must reset on agent changes. |
| Webhooks | P1.07 queued | Worker-oriented trigger architecture | Dedicated authenticated webhook receiver | **Keep P1.07.** Use a narrow receiver/capability boundary and idempotent effects. |
| Computer backends | Local macOS CUA + optional Box cloud | Docker, E2B, Daytona, desktop and fake providers; Team/Private computers | Local/cloud computer paths | **Adapt Rakazo architecture.** P1.12 should define one conformance-tested backend contract without a required Cumea cloud. |
| Human takeover | Read-only paired preview; leased takeover queued | Interactive shared computer use | Secure mobile cloud desktop access | **Do not jump straight to remote control.** P2.10 lease/heartbeat/audit boundaries must land before broad mobile takeover. |
| File/document UX | Basic attachments on current main; richer safe viewers live in draft #9 | Computer/files are first-class runtime concepts | Desktop file/task work | **Extract draft #9.** Re-port safe Markdown/PDF/DOCX viewers as a focused P0.00a PR instead of merging the old tranche wholesale. |
| Dictation | Current main does not contain the full draft #9 editable native tranche | Multi-surface product | Native dictation + voice/calls | **Extract draft #9 first**, then build P1.10 playback/calls on explicit platform capabilities. |
| Voice / calls | P1.10 queued | Mobile/desktop surface | Reply TTS and calls | **Adopt later.** Bring-your-own provider, interruption, approvals and privacy indicators are required. |
| Mobile pairing | Cryptographic one-time pairing + SecureStore token + revocation already exist | Mobile client of server API | QR onboarding plus Bonjour discovery/recovery | **Adapt discovery only as convenience.** mDNS/Bonjour may discover a host, but never establishes trust. |
| Mobile notifications | P0.10 queued | Mobile product stack | Native companion notifications | **Adopt under P0.10.** Needs You should deep-link to the exact current request and reconcile before action. |
| Mobile computer | Optional authenticated read-only screenshot preview | Remote computers are first-class | Secure live cloud desktop companion access | **Keep current read-only default.** Expand only alongside leased takeover and explicit capability authorization. |
| Accessibility / focus | Mote-specific reduced motion exists; no app-wide focus-visible/selection/reduced-motion baseline in `styles.css` | Visual E2E/product UI work | Added app-wide keyboard focus, selection styling and reduced-motion handling | **Adopt immediately.** This is a small, measurable desktop UX/accessibility gap. |
| Visual E2E | Integration coverage is strong; browser journey/screenshot history still queued | Playwright screenshots/traces/video + persistent gallery | Product UI tests | **Adopt Rakazo evidence discipline.** P0.09 should keep visual-history artifacts rather than one-off screenshots. |
| Packaging closure | Package smoke verifies core server/UI/native runtimes | Desktop packaging/testkit | Recently caught missing spawned proxy paths with explicit package-closure smoke | **Adopt.** Verify every bundled process/proxy Cumea can spawn, not only `server/index.js`. |
| Distribution | Unsigned package/layout evidence, signing/notarization queued | Desktop installers | Signed/notarized macOS, Windows installer, App Store preparation | **Adopt maturity, never claims.** P0.08 remains blocked on real signing/update/rollback evidence. |
| Mobile store readiness | Expo export/CI, no store claim | Mobile surface | iOS App Store materials | **Keep evidence boundary.** Physical-device and distribution gates precede any store-readiness claim. |
| Local dev multi-instance | CUMEA data/ports can be configured, packaged child is ephemeral | Dev/server topology | Explicit UI/API env ports for parallel instances | **Small improvement.** Document/test parallel isolated dev profiles if contributor friction justifies it. |

## Findings that changed the roadmap

### 1. Per-thread Runtime / Raw Event Inspector is now the first P1 observability tranche

Cumea already writes the two data sources an inspector needs: normalized runtime events and secret-redacted provider-native records. The missing piece is safe readback and presentation.

The implementation should:

- remain desktop-local;
- validate thread IDs before filesystem access;
- tail recent data rather than reading entire long-lived logs into memory;
- cap runtime and native streams independently so chatty native traffic cannot starve normalized events;
- tolerate a torn final NDJSON record;
- validate records at the boundary;
- present an **Events** lens that folds streaming deltas and summarizes turns/tools/requests/usage/errors;
- present a **Raw** lens with direction/source and expandable bounded JSON;
- reread on turn settlement and optionally follow local live events;
- never add raw/native material to mobile bootstrap/SSE/search/telemetry.

Tracked as **P1.11a**.

### 2. Session freshness is a correctness bug class, not a model-picker nicety

Cumea currently sends a per-instance `resumeCursor` whenever one exists. For Claude, that becomes `--resume`; the driver then sends only the new user text over stdin. The folded transcript argument does not repair a resumed stale provider session.

Therefore the sequence:

```text
Claude A → another engine B → Claude A
```

can resume A from the point before B's work. Cumea needs an explicit dispatch record such as `lastInstanceId` (or an equivalent monotonically versioned session-owner marker) and must rebuild from bounded canonical context whenever the chosen engine is not fresh for the current thread/task. Returning to an older engine must not trust its old cursor.

Tracked under **P0.12** because it is agent lifecycle correctness and recovery.

### 3. Busy-message steering should preserve user intent instead of returning only 409

Today Cumea rejects a second user message while a bot is working. A better contract is:

1. persist the user's words immediately as an ordinary transcript message;
2. visibly mark them queued while the current turn is live;
3. bound queued message count/bytes;
4. when the current turn settles, coalesce the queued steering into one attended follow-up turn;
5. define stop/interruption semantics explicitly;
6. never pretend an in-memory auto-drain intent survived a process restart unless that intent is durable.

This must apply only to explicit user steering first. Routines, peer fan-out and unattended work require their own scheduling/idempotency semantics.

Tracked as **P0.12b**.

### 4. Packaging must prove the closure of spawned helpers/proxies

Cumea's current package smoke verifies `server/index.js`, speech/CUA binaries and native runtime slices. Drivers can also spawn helper/proxy JavaScript files at runtime. A build can therefore boot and pass `/health` while a later permission/computer action fails because a sibling proxy was not packaged.

P0.08 should enumerate the spawn graph and assert every runtime-resolved helper exists in the staged package. This complements, rather than replaces, the existing Electron module-graph and native-runtime checks.

### 5. App-wide focus and reduced motion are still incomplete

Cumea correctly disables Mote animation under `prefers-reduced-motion`, but panel/pop/hover transitions and keyboard focus are not governed by an app-wide baseline. Add:

- a consistent `:focus-visible` treatment that survives component `outline-none` utilities;
- no focus ring for pointer-only clicks;
- a brand-consistent `::selection` state;
- reduced-motion treatment for panel/pop/scroll transitions without freezing semantic busy indicators into misleading static frames;
- keyboard acceptance in P0.09 journeys.

This is tracked as **P0.09a** and can be completed in a small focused PR.

### 6. Connector authorization belongs in the conversation when the task discovers it

Cumea already has a connector marketplace and can mint Composio authorization URLs. The missing loop is when an agent discovers during work that a toolkit is not connected.

Cumea should intercept that condition at the integration boundary, create a trusted Cumea-owned card, open only a validated HTTPS authorization URL, and resume the original work after connection reconciliation. The model must never supply the trusted auth URL or credential material.

Tracked as **P1.07a**.

### 7. Mobile discovery improves UX but does not change the pairing trust model

OpenMausBot's Bonjour work demonstrates a useful convenience for same-LAN enrollment. Cumea can adopt this only as host discovery before the existing one-time cryptographic pairing flow. A discovered service is untrusted metadata until the pairing secret is validated. Manual URL/QR entry must remain available.

Tracked as **P0.10a**.

## Rakazo-specific lessons

Rakazo's strongest lessons for Cumea are architectural and evidence-related rather than visual copying:

- **Computer provider abstraction:** Docker/E2B/Daytona/desktop/fake validate the value of a backend conformance contract. Cumea should preserve local/Box behavior while moving them behind P1.12.
- **Team vs Private computer semantics:** shared execution should be explicit rather than an accidental consequence of sharing one host.
- **Short-lived subagents:** useful for turn-local parallelism, but Cumea should require ownership, cancellation, depth, concurrency, output and budget limits before exposing them.
- **Provider onboarding:** device-code/subscription flows lower setup friction substantially where providers officially support them.
- **Visual E2E discipline:** retained traces/videos/screenshots and a browsable history make regressions visible in a way unit tests cannot.
- **Routine editor correctness:** edit/delete/run are part of the product contract; editor state must reset when the active agent changes.
- **Warm window:** worthwhile only after Cumea has fixed-machine before/after evidence and has defined how hidden windows stop sensitive streams/previews.

Cumea should **not** copy Rakazo's mandatory hosted-style identity/database topology into the local default.

## OpenMausBot-specific lessons

The current OpenMausBot delta surfaces several mature consumer loops that Cumea can adapt:

- per-thread normalized/raw event inspector;
- secure connector authorization triggered from chat/tool execution;
- secure QR companion enrollment with optional Bonjour discovery;
- native companion notifications;
- secure mobile access to cloud desktops;
- persisted user steering while a bot is busy;
- engine-switch freshness/context replay;
- room shared working folder;
- app-wide keyboard focus and reduced-motion treatment;
- package smoke that verifies spawned runtime proxies;
- signed/notarized consumer desktop and active iOS distribution work;
- reply voice/calls and native dictation.

Cumea should **not** broaden its remote surface simply to match these features. Raw inspector data remains local; mobile computer control waits for the leased takeover model; auth links remain Cumea-owned and allowlisted.

## Updated execution order

This audit changes implementation order as follows:

1. **P1.11a — local Runtime/Raw Event Inspector.** Existing logs make this the highest-value small tranche.
2. **P0.00a — extract safe file/document viewers from draft #9.** Re-port onto current main, never merge the historical tranche wholesale.
3. **P0.05 + P0.06 — steady-state render isolation and long-thread windowing.** P0.11 removed backend write/search scaling as the blocker; renderer scale is now exposed.
4. **P0.09a — keyboard focus / selection / app-wide reduced motion.** Small UX/accessibility gap with easy visual evidence.
5. **P0.12a/b/c — liveness, busy steering, and engine-session freshness.** Treat these as lifecycle correctness, not polish.
6. **P0.00b/c — extract native editable dictation and mobile paging from draft #9.** Rebase concepts onto the current mobile/bootstrap contracts.
7. **P0.10a/b — discovery/pairing convenience and native Needs You notifications.** Keep cryptographic pairing authoritative.
8. **P0.08a — package spawn-closure smoke** before consumer signing work advances.
9. **P1.07a — trusted in-chat connector authorization/continuation.** No model-authored auth URLs.
10. **P1.08a — guided provider install/login/device-code flows.** Only official supported auth mechanisms.
11. **P1.06 — inspectable revisioned memory.** Build on canonical local persistence and explicit budgets.
12. **P1.12 + P2.03 — computer backend contract and bounded subagents/delegation.** These unlock larger autonomous workflows without losing ownership/budget controls.

## Smaller UI/UX improvements to fold into existing work

- make the bot context menu a true keyboard/focus menu and expose both Mark Read and Mark Unread;
- add real date separators, copy affordances and cheap collapse/expand for very long user messages;
- distinguish provider setup/auth failures from retriable runtime failures in visible error rows;
- preserve composer drafts per conversation and make edit/branch work IME-safe;
- do not let a stale pagination response overwrite newer SSE state;
- reset routine/editor panels when the active agent changes;
- expose queued steering clearly instead of making a second send look lost;
- show model/engine freshness or context-rebuild transitions only when they affect user expectations, not as internal jargon;
- retain screenshot/visual-history evidence for keyboard focus, long-thread anchors, pairing, approvals and degraded computer states.

## Explicit non-goals from the comparison

The audit does **not** recommend:

- mandatory Better Auth / Postgres / hosted identity for local Cumea;
- a Cumea-operated managed VM or required hosted sandbox;
- readable provider secrets in browser/renderer state;
- treating Bonjour/mDNS discovery as authentication;
- exposing raw provider/native inspector events to the paired mobile surface;
- letting a model author a trusted connector authorization URL;
- enabling remote computer control before lease, heartbeat, expiry and audit semantics exist;
- copying competitor branding, terminology, assets, prompts, layouts or private implementation details;
- importing benchmark numbers from a competitor's machine as evidence about Cumea.

## Review cadence

Competitive audits should be repeated only when they can change engineering decisions. Record exact source commits, merge backlog changes through a normal PR, and require the same protected-branch gates as product code. The audit is an input to Cumea's roadmap, not an alternative roadmap.
