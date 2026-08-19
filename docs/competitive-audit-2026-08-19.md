# Competitive engineering audit — 2026-08-19

This is a code-level comparison, not a feature-count exercise. The goal is to keep Cumea's own product
identity — a local-first, self-hosted council of agents with no mandatory Cumea account or control plane —
while adopting implementation ideas that materially improve usability, correctness, performance, or release
quality.

## Pinned revisions

- Cumea: `ea3d751bee4007961ecce703e306539b80a4ad6f`
- Rakazo: `c3d386d87fff65ba8616400a81d2ace410e42634`
- OpenMausBot: `70805c0afcbc29e595d0e5393160a0db00602d02`

The pins matter because both comparison projects are moving quickly. Every conclusion below should be
rechecked before implementing a large tranche.

## Evidence boundary

This audit is based on the pinned repositories' source, tests, documentation, recent commits, and checked-in
performance/release methodology. It does **not** independently reproduce competitor benchmarks, hosted
services, signed releases, real sandbox providers, phone hardware, or production accounts. Likewise, an item
being promoted into Cumea's roadmap is a design decision, not evidence that Cumea already implements or
outperforms it. Fixed-machine performance and native/physical-device acceptance remain their existing gates.

## Executive view

Cumea is now strongest where the previous audits found foundational risk: owner-local canonical SQLite
transcripts, revision-aware search, rollback-safe deletion, OS-backed packaged credentials, atomic bootstrap,
engine/session freshness, attended busy-user steering, bounded Runtime/Raw diagnostics, and lifecycle
working/waiting/no-signal/dead evidence. Those are no longer parity gaps.

Rakazo is currently ahead in multi-user/team-scale orchestration, memory/history compaction, pluggable sandbox
breadth, parallel shared-computer screens, provider onboarding, visual/E2E evidence, and runtime performance
coverage. OpenMausBot is ahead in consumer desktop distribution, voice/calls, companion connectivity,
connector continuation, webhook triggers, BYO-VPS/phone computer backends, and polished messaging-app utility
surfaces such as command navigation.

The next Cumea work should therefore focus on product scale and consumer completion rather than rebuilding
already-solved storage or lifecycle foundations.

## Decision matrix

| Area | Cumea now | Rakazo / OpenMaus evidence | Decision |
|---|---|---|---|
| Canonical transcript persistence | SQLite/WAL source of truth with revisions, crash recovery and rollback-safe deletion | Rakazo uses Postgres; OpenMaus remains local harness oriented | **Keep Cumea** |
| Local transcript search | Derived revision-aware SQLite index, exact bounded navigation and redacted export | Competitors have useful navigation, but no reason to replace Cumea's local index | **Keep Cumea** |
| Lifecycle / stale sessions | P0.12 complete: liveness evidence, busy steering, native-session freshness | Similar failure classes continue appearing upstream | **Keep Cumea**, extend only with durable effect journal later |
| Long transcript rendering | Bounded API windows exist, but mounted-thread rendering is not fully windowed | Rakazo performance suite explicitly measures 100-message typing/streaming; mature clients avoid full-list work | **Adopt** P0.05/P0.06 |
| Warm desktop reopen | Not implemented | Rakazo benchmarks retained warm-window vs destroy/recreate | **Adapt** with Cumea privacy TTL/sanitization |
| Performance evidence | Packaged launch runner, budgets and fixed-machine gate designed | Rakazo also measures typing, streaming, idle CPU/memory and settings transition latency | **Adopt** additional steady-state scenarios |
| Conversations vs agents | One primary thread still closely coupled to one agent | Rakazo can clear a conversation without deleting its bot | **Adopt** as part of P1.01, but prefer multiple conversations rather than destructive reset as the only model |
| Memory / history compaction | Explicit memory is still roadmap work | Rakazo compacts old history into Supermemory, shrinks verbatim history only after recall succeeds, bounds summarization and drains backlog | **Adapt**: owner-local default memory/compaction with optional external adapter; never make Supermemory mandatory |
| Team/shared computer | Current local/cloud computer is principally per-agent | Rakazo has Team vs Private computers and per-bot graphical leases with fencing so teammates can share files while owning separate displays | **Adapt** into P1.12/P2.10 with explicit shared scope and run fencing |
| Computer provider breadth | Local CUA + Box/cloud path | Rakazo: Docker/E2B/Daytona/Box/local. OpenMaus: Box/local plus hardened Docker-over-SSH BYO VPS | **Adopt contract, not providers by default**: pluggable user-owned backend SPI; add BYO VPS first |
| BYO VPS | Not implemented | OpenMaus uses local Docker CLI over a preconfigured SSH alias, no public VPS ports, hardened per-bot container, transport timeouts/cache/recovery | **Adapt** as P1.12a; SSH config remains user-owned and aliases stay off mobile |
| User-owned phone/device computer | Mobile is a control surface, not a bot computer | OpenMaus added isolated USB Android control / Phone Harness | **Consider** after generic computer SPI; do not conflate paired companion with agent-controlled device |
| Mobile host discovery | Secure QR/manual pairing exists; same-LAN discovery is roadmap | OpenMaus advertises mDNS, ranks interfaces, sends an ordered host-candidate list, rotates on reachability errors and persists the successful candidate | **Adopt** into P0.10a; discovery is convenience only, never authentication |
| Companion host lifecycle | User enables remote listener; current reconnect is bounded | OpenMaus persists sidecar enablement, re-advertises after interface changes and distinguishes transport/auth errors | **Adapt**: optional host-autostart preference, interface-change re-advertise, candidate rotation, actionable errors |
| Mobile live computer takeover | Read-only preview by default | OpenMaus can grant secure live cloud desktop access to an individual paired phone | **Reject for now** until Cumea P2.10 human lease/audit boundary exists |
| Provider onboarding | Provider detection/model picker exists; guided login is roadmap | Rakazo Pi supports API-key and device/subscription flows; OpenMaus continues improving CLI login detection | **Adopt** P1.08a with official flows and explicit billing/subscription distinction |
| Connected-app auth | Marketplace/settings authorization exists; task continuation is roadmap | OpenMaus creates trusted in-chat connector authorization; Rakazo synchronizes live Composio auth state | **Adopt** P1.07a with server-authored cards/URLs, never model-authored auth links |
| Routines / triggers | Schedules exist | OpenMaus has authenticated webhook-only receiver; Rakazo has durable worker topology | **Adopt** authenticated webhook trigger in P1.07 with idempotency/effect journal dependency |
| Voice / calls | Dictation base exists but full voice/call product does not | OpenMaus supports TTS, per-bot voices and calls | **Adopt later** P1.10; keep speech capability/provider status explicit |
| Command navigation | Global agent/message search exists | OpenMaus ships a broader command palette | **Adapt**: evolve the existing search into keyboard command/navigation rather than add a competing second palette |
| Attachments | Durable bounded uploads exist | Rakazo recently added photo/file attachment UX | **Keep foundation**, finish P0.00a safe local viewers and richer preview UX |
| Safe document viewers | Historical draft #9 contains bounded Markdown/PDF/DOCX work, not yet re-ported | Competitors expose file-heavy workflows | **Adopt from our own #9**, not from competitors |
| Release distribution | Developer Preview; unsigned/notarized consumer release not claimed | OpenMaus publishes signed/notarized macOS and Windows installer; Rakazo maintains broad app surfaces | **Adopt** P0.08 distribution gates |
| Package runtime closure | Top-level package smoke exists | OpenMaus/Rakazo increasingly spawn helpers, sandboxes, proxies and platform binaries | **Adopt** P0.08a complete spawn-closure verification |
| Browser/visual E2E | Current CI has source/build/package gates; real-browser journey set is incomplete | Rakazo retains Playwright traces/screenshots/videos and supports fake plus real sandbox variants | **Adopt** P0.09 with safe retained visual history |
| Multi-user hosted identity | Cumea intentionally has no mandatory account/control plane | Rakazo uses Better Auth/Postgres and a shared web/API topology | **Reject as default**; optional team/server mode remains separate P2.11 |
| Hosted memory dependency | Not required | Rakazo Supermemory is feature-gated | **Reject as mandatory**; optional adapter may be useful after local memory contract exists |

## UI / UX findings

### What Cumea should keep

Cumea's product shape remains closer to the Grok Bot concept than a generic agent dashboard: persistent agent
roster, central conversation surface, optional right-side Work/Computer/Apps/Diagnostics surfaces, Mote
identity, one global search, Needs You, and the same mental model on desktop/mobile. The new busy-steering
composer also removes a major messaging-app mismatch: the user can continue talking while work is running.

Do not replace that with Rakazo's account/workspace navigation or introduce a second parallel command/search
system just because OpenMaus has a CommandPalette component.

### Improvements to adopt

1. **Conversation reset/new conversation.** Rakazo now permits clearing a conversation without deleting the
   bot. Cumea should solve the broader problem in P1.01: one Agent owns multiple Conversations, with New
   conversation, archive, search and export. A destructive "clear" can then be a deliberate conversation
   action rather than erasing the agent identity.
2. **Long-thread UX.** The current exact-message window proves bounded server navigation, but normal desktop
   reading still needs prepend paging, mounted-row windowing, near-bottom auto-follow and cheap long user
   messages. P0.06 remains high priority.
3. **Command navigation.** Extend the existing global search with commands/actions and keyboard focus rather
   than ship a separate modal competing with search.
4. **File preview.** Re-port the inert Markdown/PDF/DOCX viewers from draft #9 and integrate them with current
   canonical attachment IDs and local capability boundaries.
5. **Routine editing.** Rakazo's recent UI makes running/testing a routine part of its editor. Cumea should
   keep routine creation/edit/run in one coherent surface rather than scatter actions.

## Performance findings

Cumea already has a stronger production-build startup evidence foundation than it did in the first audit:
packaged first-run/returning/cache scenarios, raw reports, medians/p95, bundle budgets and explicit evidence
limits. The remaining weakness is **steady-state** measurement and implementation.

Rakazo's current benchmark protocol explicitly measures:

- shell usable with a 100-message thread;
- settings paint vs transition settle;
- keydown-to-next-frame typing latency;
- streaming through the real subscription/reducer path;
- idle CPU and summed process working-set memory;
- retained warm-window reopen vs destroy/recreate.

Cumea should add comparable *definitions*, not copy thresholds or claim relative speed. P0.05 should be
implemented against typing/streaming evidence, P0.07 against reopen evidence, and P0.01c/P0.03c remain blocked
on one fixed labelled Mac rather than hosted-runner numbers.

## Persistence and memory

Cumea should **not** undo P0.11 in pursuit of Rakazo's Postgres architecture. SQLite remains the correct
single-owner local default and Postgres remains an optional future team/server mode.

Rakazo's new Supermemory-backed compaction does expose a product problem Cumea still needs to solve:
conversation history cannot grow verbatim forever. The useful ideas are the safeguards:

- compact only old history in bounded batches;
- do not shrink the verbatim window until compaction exists **and recall succeeds**;
- bound summarizer input and timeout;
- never advance the compaction cursor on a failed/empty summary;
- drain old backlog asynchronously;
- mark recalled material as potentially stale data, not instructions.

Cumea's version should use an owner-local memory/summary store by default, keep provenance/revision/delete
controls from P1.06, and only then allow optional external memory adapters.

## Computer and orchestration

This is the largest new competitive delta.

### Rakazo Team Computer

Rakazo distinguishes a shared **Team Computer** from isolated **Private** computers. Its recent screen work
allows multiple bots on one shared sandbox to own distinct graphical displays, with per-run/per-bot screen
leases and fencing to stop delayed or stale work from stealing a newer screen. That is substantially better
than merely saying "shared sandbox".

For Cumea this belongs in the computer backend contract:

- explicit scope: private-agent vs shared-project/team;
- independent display/session capability separate from shared filesystem capability;
- lease owner = run/agent, with fencing generation;
- stale claimant rejection;
- deterministic release on completion, rollback and takeover;
- honest provider capability: some backends may share files but support only one graphical session.

### OpenMaus BYO VPS

OpenMaus' new VPS backend is a useful local-first reference because the agent runtime remains local and the
user owns the remote machine. Important safeguards worth adapting:

- SSH configuration/key ownership stays in `~/.ssh`, not the app database;
- use a named SSH alias, never auto-accept a host key;
- no public container ports;
- refuse unmanaged/mis-hardened containers instead of "repairing" them silently;
- distinguish missing container from transport failure;
- transport timeout/keepalive and bounded lock acquisition;
- cache expensive status checks;
- treat remote container filesystem as explicitly disposable;
- never expose the SSH alias to paired mobile clients.

Cumea should add this only after the generic P1.12 backend conformance contract, so Box/local/VPS do not grow
three unrelated lifecycle implementations.

## Mobile companion

OpenMaus' recent companion work is more mature than Cumea's current connectivity convenience layer. The
security lesson is **not** to weaken pairing; it is to make transport selection resilient after pairing.

P0.10a should include:

1. Bonjour/mDNS discovery with per-interface sending and ranked interfaces;
2. pairing response containing an ordered bounded list of candidate hosts;
3. client candidate rotation only for transport/address failures, never for 401/auth failures;
4. persist the candidate that successfully carries a live stream;
5. re-advertise/withdraw on interface changes;
6. optional remembered host-listener enablement after a successful start;
7. manual address editing that retains the pairing token;
8. actionable error copy that distinguishes name resolution, refusal, timeout, offline and authentication.

Discovery metadata remains unauthenticated convenience data. Device tokens and pairing remain the trust
boundary.

## Provider and app integrations

Rakazo's Pi onboarding and OpenMaus' CLI status fixes reinforce P1.08a: a consumer product should tell the
user whether an engine is installed, authenticated and usable, and guide official device/subscription login
where the runtime supports it. "Paste an API key" must not be presented as the only path when a user already
pays for a supported CLI subscription.

OpenMaus' in-chat connector continuation and Rakazo's live Composio reconciliation reinforce P1.07a. The
safe Cumea pattern is:

- tool reports a typed missing-connection condition;
- harness creates the auth card and validates an allowlisted HTTPS destination;
- browser opens it;
- harness reconciles provider state;
- original task resumes exactly once through the durable run/effect boundary.

Never render arbitrary model text as an authorization URL.

## Release and testing

OpenMaus remains ahead on consumer distribution: signed/notarized macOS artifacts and a Windows installer.
Rakazo remains ahead on retained browser journey evidence and sandbox matrix testing. Cumea should retain its
stricter claim boundary while closing those gaps:

- P0.08: signing/notarization/updater/rollback/channel work;
- P0.08a: verify the complete executable/helper/proxy spawn closure in packaged artifacts;
- P0.09: Playwright journeys for onboarding/chat/approvals/files/Needs You/routines/pairing/computer
  degradation with bounded safe screenshots/traces;
- real-provider/computer canaries stay manual or explicitly credential-gated, never automatic PR defaults.

## Ordered follow-up after this audit

1. **P0.00a** — re-port safe file capability + Markdown/PDF/DOCX viewers from draft #9.
2. **P0.05 + P0.06** — renderer isolation, streaming batching, transcript windowing and scroll contract,
   with typing/streaming evidence.
3. **P0.10a** — resilient discovery/candidate rotation before additional mobile product features.
4. **P1.01a** — establish Agent → Conversations separation and New/Clear conversation semantics.
5. **P1.06a** — owner-local bounded history compaction feeding explicit memory/provenance.
6. **P1.12a** — computer backend conformance + user-owned BYO VPS.
7. **P1.12b** — shared Team/Project computer scope with per-run screen leases/fencing.
8. **P0.08a / P0.09** — package spawn closure and real-browser retained evidence.
9. **P1.07a / P1.08a** — trusted connector continuation and guided provider login.
10. **P1.10** — voice/calls after the dictation tranche is cleanly re-ported.

P0.01c and P0.03c still require the fixed-machine Mac evidence gate and must not be falsely closed by hosted
CI.
