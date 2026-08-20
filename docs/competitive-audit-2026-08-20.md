# Competitive engineering audit — 2026-08-20 morning refresh

This document re-audits Cumea against the latest public revisions of Rakazo and OpenMausBot available on the morning of 20 August 2026. It is an engineering/product delta, not a feature-count contest: a competing behavior is useful only when it fits Cumea's local-first trust model and can be verified with the same evidence discipline used by Cumea.

## Pinned revisions

- **Cumea:** `1c61e3da6bd9ada7f7db41fe1962b0195679a304` — PR #41 merged, semantic contrast gate live.
- **Rakazo:** `f0a2cb20d5f1076c7f34a71b5f65144e5a509f5e`.
- **OpenMausBot:** `6b2ca7e0af1980cef38fa6eedaad3555e4955189`.

This supersedes the prioritization in `competitive-audit-2026-08-19.md`. Earlier audits remain historical evidence for why the current queue exists.

## Executive comparison

| Area | Cumea | Rakazo | OpenMausBot | Decision |
|---|---|---|---|---|
| Local-first default | Strong: no account/control plane required | Server/account-oriented stack is central to many flows | Strong local desktop | Keep Cumea default; reject mandatory hosted identity |
| Agent vs conversation | One primary conversation per agent | Conversation reset without deleting bot | Rich rooms/history | **Highest product gap: P1.01** |
| Transcript/storage | Canonical SQLite/WAL, derived search, exact navigation/export | History + compaction | Durable local history | Cumea foundation is strong; build conversations/memory above it |
| Session/liveness | Freshness, queued steering, lifecycle watchdog | Long-thread/perf focus | Rooms/approval cancellation hardening | Preserve Cumea invariants; extend cancellation reconciliation |
| File output | Opaque local capabilities, inert Markdown/DOCX; PDF pending | Files/photos | Secure raster attachments | Finish PDF and add raster image signature/decode/capability gate |
| Desktop performance | Strong launch harness; steady-state incomplete | Best reference for typing/streaming/settings/idle methodology | Less useful as renderer benchmark | **P0.05/P0.06 remain high priority** |
| Desktop long threads | Search windows; primary transcript still mounts too much | Long-thread measurement | General history | Window rows and preserve anchor/selection |
| Mobile shell | Secure agent-list-first companion | One-screen mobile drawer/overlay | iOS Messages-shaped companion | Keep Cumea identity; improve connectivity and new-message affordance |
| Mobile distribution | Source/export evidence only | Mobile app | App Store packaging/upload path | Add signed physical + store evidence gate; no claim from JS export |
| Computer model | Local CUA + Box; Codex parity | Team/Private computer concepts | BYO VPS/Linux local control | Provider-neutral contract + fenced shared/private leases |
| Linux local control | No claim; source/package portability only | Mixed desktop/web | Ubuntu installables + CUA work | Add installed-runtime/provenance + physical GNOME gates before claim |
| Provider parity | Claude strong; Codex handoff/computer live | Broad runtime abstractions | Fast provider parity; Gemini auth hardening | Add structured auth/model-binding probes; Codex Composio remains separately gated |
| Voice | Native macOS dictation primitive; historical hardening pending | Pluggable speech providers | Voice/call surface | Finish native STT correctness before TTS/calls |
| Sections | Already present | Project/team concepts | Sidebar sections newly added | **No gap:** polish Cumea sections, do not duplicate feature |
| Reactions/pins | Planned under message UX | — | Rich reactions + one pinned message/thread | Useful P1.04 follow-up after conversations |
| Rooms | Planned | Shared/team surfaces | Rooms, approval fixes, timeout recovery | Durable approvals/cancel/timeout invariants before Room polish |
| Theme/accessibility | Focus/reduced motion + semantic contrast CI | Polished UI/perf | Skin + contrast tooling | Keep one strong identity; deterministic gates already adapted |
| Distribution | Package closure; signing/notarization open | Multi-surface workflow | Desktop + iOS distribution advancing | Distribution remains a real competitive gap |

## What Cumea already does better or more defensibly

Cumea should not erase its own advantages while chasing surface parity:

- canonical owner-local SQLite transcript persistence rather than whole-thread rewrites;
- local search with exact-message windows/export and no paired-mobile diagnostic leakage;
- dispatch-based provider-session freshness across A→B→A/provider reload transitions;
- durable attended busy-user steering with bounded queue/coalescing semantics;
- explicit working/waiting/no-signal/dead lifecycle projections and repeated-effect alerts;
- desktop Runtime/Raw diagnostics with bounded redacted native payloads;
- OS-backed packaged credential vault with fail-safe migration/restart rollback;
- atomic bootstrap + monotonic SSE cursor reconciliation;
- packaged server entrypoint/import closure including sidecars;
- owner-local opaque file capabilities with paired/mobile denial and path-free projection;
- dependency-free bounded DOCX semantic parsing and inert Markdown/DOCX rendering;
- verified Codex peer-agent + local/cloud computer mounts with secret values outside argv;
- deterministic semantic dark-theme WCAG gate.

These are product foundations, not internal trivia: they make future Rooms, conversations, BYO computers and mobile actions easier to reason about.

## UI / UX

### Agent identity and fresh context

Rakazo's clear-conversation behavior reinforces P1.01: persistent agent identity must not be coupled to one transcript. Cumea should support multiple named/archivable conversations, New conversation, search/export and one-conversation destructive clear with recovery confirmation. Agent settings/memory/identity survive.

### Reading long conversations

Desktop is still the larger UX gap. Window mounted rows independently from server paging, retain an anchor through prepend/search-window transitions, auto-follow only while near the newest edge, preserve text selection/copy, and expose show-earlier/jump-latest affordances.

Mobile already has paged data, inverted FlatList rendering, `maintainVisibleContentPosition`, bounded render batches and load-older. The useful historical #9 delta is small: if the user scrolls away from the newest edge, incoming messages increment `N new` instead of yanking the viewport; tapping the affordance jumps to latest and resets the count.

### Sections, pins and reactions

OpenMausBot's new sidebar sections are not a Cumea gap: Cumea already has sections. The useful work is polishing section creation/reorder/search/accessibility rather than adding a second organizational concept.

One pinned message per conversation and a richer reaction palette are useful but should live under P1.04 after Agent→Conversations lands. Pin identity must point to a stable conversation message ID and fail harmlessly if a branch/edit/delete invalidates it.

### File and image UX

Cumea's current file authority is safer than exposing arbitrary host paths, but raster images deserve a first-class bounded path rather than remaining generic binary files. Adapt OpenMausBot's useful direction with a stricter boundary:

- accept only PNG/JPEG/WebP initially; keep SVG rejected from the image renderer;
- verify signature/decoded dimensions rather than trusting `Content-Type` or extension;
- cap encoded bytes, pixel count, decoded memory and dimensions;
- generate host-owned IDs/names; never use model/user path as a serving route;
- preview through an opaque local capability, `no-store`, no `file://`/arbitrary URL;
- advertise provider `images` capability only when that engine can actually consume the attachment;
- remote/mobile projection remains explicit and separately authorized.

GIF/animation should stay download-only until animation/decode budgets are deliberately designed.

## Performance

Rakazo remains the best reference for the measurement protocol, not necessarily the implementation. Cumea should extend its existing packaged evidence format with:

- keydown → next-frame/paint latency on bounded long transcripts;
- real reducer/SSE streaming cadence rather than synthetic string append only;
- settings first-paint and settle;
- idle CPU and working-set memory;
- mounted-row count / render-work evidence at 100, 1,000 and bounded larger transcript fixtures;
- warm retained renderer vs destroyed renderer only after P0.05/P0.06 are measured;
- fixed-machine trend series before publishing performance claims.

The likely engineering order remains selector/update isolation first, then transcript windowing, then optional warm-window reuse.

## Provider onboarding and model binding

OpenMausBot's Gemini authentication hardening and earlier model-binding work expose a class of UX/correctness issue Cumea should make explicit:

- provider discovery reports `missing`, `installed-unauthenticated`, `ready`, `transport-error` separately;
- auth detection should use the provider's strongest available structured signal, not one brittle stdout substring;
- onboarding clearly distinguishes subscription/device-code CLI auth from API-key billing;
- model selection is not considered proven because the picker changed: tests must show the selected model reaches spawn/session/runtime protocol where supported;
- Codex connected apps remain gated until Cumea proves the Composio transport through app-server; generic MCP support is not evidence.

## Cancellation and approvals

OpenMausBot now closes approvals when a turn is cancelled. Cumea should adopt the invariant, not its implementation:

- every pending provider/connected-app/computer approval belongs to durable conversation/run/effect identity;
- explicit Stop/cancel/turn replacement closes or invalidates pending requests for that exact run;
- an old card cannot approve a later effect after cancellation/restart;
- desktop, Needs You and mobile reconcile the same request object;
- cancellation is idempotent and does not manufacture a second rejection effect.

This should become a focused P0.12 follow-up before Rooms reuse the approval machinery.

## Rooms lifecycle

OpenMausBot's configurable Room turn timeout is useful mainly as evidence of failure modes. Future Cumea Rooms should have:

- durable room/conversation/run ownership for approvals;
- bounded per-turn timeout/recovery policy, configurable only within sane min/max limits;
- restart/reconnect reconciliation;
- exact release of stalled speaker/run state;
- no timeout that silently converts an uncertain external effect into a retry.

Do not implement Room cosmetics before P1.01 and the durable approval/cancellation contract.

## Mobile connectivity and distribution

Cumea's security model is competitive; the remaining work is reliability and evidence:

1. Bonjour/mDNS is discovery only, before cryptographic pairing. Rank real interfaces ahead of tunnels/bridges and rotate candidates only on transport/address failure, never on 401.
2. Native Needs You notifications reconcile live host state before exposing an action.
3. Physical microphone, VoiceOver/TalkBack, reconnect/background evidence is required.
4. Add a signed iOS/Android distribution gate: deterministic bundle/application IDs, production signing/export profiles, privacy/permission declarations, current-device screenshots and store/archive verification. OpenMausBot uploading an App Store build is useful competitive evidence; Cumea must not claim equivalent readiness from Expo JS export.

## Voice

Rakazo's pluggable speech work still supports the same architecture: STT, TTS and call transport are separate capabilities. First finish P0.00b by extracting only the good behavior from historical #9:

- microphone + speech-recognition permission/error taxonomy;
- idempotent session start/stop and stale-process suppression;
- editable partial/final transcript;
- typing while listening stops the recording rather than fighting user edits;
- explicit macOS-only availability today;
- no silent cloud fallback.

Then P1.10 can add BYO TTS/call transports with abortability, spend bounds and a strict spoken-approval vocabulary.

## Portable definitions

Keep P1.05 additive-only first:

- strict allowlist/version bounds;
- fresh local IDs; case-insensitive deterministic name collision handling;
- re-import creates a fresh numbered set rather than overwriting edited local objects;
- imported files cannot grant auto-approval, persistent allow rules, peer privilege, connected-app authorization, computer authority, host cwd, credentials or private IDs;
- replacement/archive is a user-selected local operation, never chosen by the imported file.

## Computer architecture

The provider-neutral direction remains correct. The contract should expose capability and ownership, not vendor APIs:

- Private agent vs Shared Team/Project scope;
- independent shell/files/graphical/checkpoint capability bits;
- `ready`, `provisioning`, `missing`, `transport-error`, `unavailable` states;
- fenced graphical session leases with random lease ID + monotonic generation so stale completion cannot release a newer owner;
- provider-neutral checkpoint/export/import primitive where a backend supports it;
- local CUA and Box adapters only after the contract itself is tested;
- BYO VPS via preconfigured SSH alias/Docker: no stored private key, no auto-accept host key, no public ports, bounded status/lock calls, ownership labels and no SSH alias projected to mobile.

A Cumea-operated sandbox/control plane remains out of the default product.

## Linux distribution

Do not translate "we can build on Linux" into "Linux local computer works". Add explicit gates:

- no runtime dependency on Node/pnpm downloads in installed packages;
- pinned native-driver source/archive hash and inner binary/member hashes;
- archive member name/type/size preflight and safe extraction;
- licenses/notices and CycloneDX evidence;
- external driver override only via explicit absolute path;
- bundled native-driver start/cleanup smoke under the package environment;
- GNOME Xorg and Wayland hands-on acceptance, with any Wayland helper/extension manually and visibly installed;
- local desktop control remains opt-in and never a silent fallback from cloud/auto selection.

## Adopt / adapt / reject

### Adopt now

- steady-state performance methodology and fixed-machine trend discipline;
- durable cancellation invalidation for pending approvals;
- secure raster image pipeline with provider capability gating;
- structured provider auth/model-binding evidence;
- signed physical/store mobile distribution evidence;
- additive-only portable definitions;
- provider-neutral computer capabilities/checkpoints and fenced leases;
- Linux installed-runtime/native payload provenance gates;
- mobile host discovery as unauthenticated candidate discovery only.

### Adapt

- Rakazo conversation reset → multiple conversations under one durable Cumea agent;
- Rakazo history compaction → owner-local provenance-first bounded compaction over canonical SQLite;
- Rakazo voice → native STT correctness first, then separable BYO TTS/calls;
- OpenMaus pins/reactions → message UX after conversation identity is stable;
- OpenMaus Room timeout → bounded durable Room recovery, not a global kill timer;
- OpenMaus App Store work → signed Cumea companion evidence, not copied identifiers/assets;
- OpenMaus BYO VPS → optional user-owned backend, never mandatory hosted service.

### Reject for the default product

- mandatory account/Better Auth;
- mandatory Postgres for single-user local mode;
- hosted memory as default source of truth;
- Cumea-operated mandatory control plane/sandbox;
- silent native-helper/extension installation;
- silent fallback from native speech/computer to a cloud provider;
- trusting upload MIME/extension as image safety proof;
- treating generic MCP transport or picker state as provider capability evidence.

## Ordered consequence

1. finish **P0.00c mobile new-message behavior** and **P0.00b dictation hardening**;
2. close safe-file work with bounded PDF.js/browser evidence and a secure raster-image sub-gate;
3. add **P0.12d approval invalidation on cancellation**;
4. build **P0.05a/P0.06** steady-state evidence and desktop transcript windowing;
5. implement **P1.01 Agent → Conversations**;
6. implement **P0.10a/P0.10b** discovery + push, plus signed mobile distribution/physical evidence;
7. add **P1.05** additive-only definitions and provider auth/model-binding evidence;
8. complete **P1.12** contract → current adapters → BYO VPS → Team/Private leases/checkpoints;
9. add Linux installed-runtime/native-control evidence before any Linux local-control claim;
10. add owner-local memory compaction; only then build Rooms, Chief of Staff and Council workflows.

This order keeps Cumea differentiated by correctness, privacy and inspectability while selectively taking the strongest engineering ideas from both competitors.