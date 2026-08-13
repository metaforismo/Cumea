# Cumea roadmap

This is the bootstrap backlog as of 2026-08-13. It is deliberately ordered: reliability, privacy,
and consent come before provider count or visual expansion.

## P0 — trustworthy foundation

- [x] Establish an independent Cumea identity, bundle ID, data directory, and runtime namespace.
- [x] Remove embedded upstream analytics and remote email identification.
- [x] Wait for the Claude permission socket before spawning the agent process.
- [x] Bound desktop shutdown and stop dictation during quit.
- [x] Restrict external URL opening and renderer navigation.
- [x] Add request-origin checks, CSP/security headers, safe static-path resolution, and bounded JSON parsing.
- [x] Persist configuration and transcripts with unique temporary files, full-write guarantees,
  file and directory flushes, atomic replacement, failure cleanup, and owner-only permissions.
- [x] Scope provider-native tool and approval IDs to their thread and clear stale state on reload.
- [x] Bound Codex JSON-RPC calls so a silent app-server cannot hang a turn forever.
- [x] Fix connected-app OAuth polling to decide from the freshly fetched status.
- [x] Confirm the first Cumea CI matrix is green on macOS, Ubuntu, and Windows
  ([run 31627113168](https://github.com/metaforismo/Cumea/actions/runs/31627113168)).
- [x] Add focused regression tests for origin rejection and malformed JSON.
- [ ] Add a raw-request regression test for encoded static traversal attempts.
- [x] Persist every operational message as a task/run with tool steps, approval state, handoffs,
  artifacts, failure recovery, and bounded history.
- [x] Replace the placeholder routine UI with durable interval/daily/weekly schedules, pause,
  run-now, due dispatch, failure history, and “Teach as routine”.
- [x] Add a “Needs you” approval inbox and remembered per-bot Ask / Always / Never policies.
- [x] Add an opt-in authenticated mobile listener with expiring single-use pairing, hashed device
  tokens, local revocation, allowlisted mobile projections, and sanitized SSE events.

## P1 — usability and portability

- [x] Reimplement API-key setup guidance with accessible provider-specific billing and data-flow copy
  ([upstream PR #27](https://github.com/milind-soni/OpenMausBot/pull/27)).
- [ ] Rebase the Linux desktop work onto Cumea's hardened core; validate both Xorg and Wayland
  before calling it supported ([upstream PR #32](https://github.com/milind-soni/OpenMausBot/pull/32)).
- [ ] Build one shared platform abstraction for executable shims, process trees, sockets/pipes,
  paths, and icons before taking a Windows port
  ([upstream PR #10](https://github.com/milind-soni/OpenMausBot/pull/10)).
- [ ] Reassess the default provider fleet and authentication expectations
  ([upstream issue #28](https://github.com/milind-soni/OpenMausBot/issues/28)).
- [ ] Add a privacy/settings page showing exactly which integrations are enabled and where data goes.
- [x] Make sidebar search functional and add persistent sections with create, rename, delete, and
  bot assignment flows.
- [x] Add bounded local attachments with task artifacts and audited HTTP upload/download/delete.
- [ ] Add audit-aware attachment retention and storage management so long-lived agents can reclaim
  quota without deleting the agent or silently breaking historical artifacts.
- [x] Add unsigned Linux/Windows packaging targets and explicit feature degradation. These targets
  are build preparation only: no Linux or Windows device validation has been performed.
- [ ] Add hands-on Windows and Linux smoke suites once suitable devices or CI desktop sessions are
  available; packaging alone does not satisfy this item.
- [x] Add persistent Mote-based avatars with eight shapes, eleven colors, local generation, bounded
  raster upload, semantic working/Needs-you/success/error motion, and reduced-motion behavior.
- [x] Implement an Expo companion whose post-pairing root is the searchable agent list, with
  per-agent chat, stop, Needs-you responses, routine status, SecureStore enrollment, and demo mode.
- [ ] Complete signed iOS/Android physical-device acceptance, including in-app camera pairing,
  explicit paste/manual enrollment, SecureStore persistence, reduced motion, VoiceOver/TalkBack,
  and reconnect behavior. Do not place pairing secrets in operating-system launch URLs.

## P2 — extensibility

- [ ] Define an out-of-process provider/plugin contract before adding experimental drivers.
- [ ] Evaluate Antigravity only with per-action consent or a clearly labeled explicit full-auto mode
  ([upstream PR #30](https://github.com/milind-soni/OpenMausBot/pull/30)).
- [ ] Treat AI Counsel as an optional adapter, not a built-in dependency
  ([upstream PR #22](https://github.com/milind-soni/OpenMausBot/pull/22)).
- [x] Keep the Grok-like three-pane bot/chat/computer interaction model as the visual direction;
  avoid a product redesign while replacing only protected trademarks or proprietary assets.
- [ ] Add accessibility, keyboard-navigation, reduced-motion, and screen-reader acceptance checks.
- [x] Add global keyboard focus visibility, semantic controls, a Command/Ctrl-K search shortcut,
  and browser checks for the new work/section/routine flows.
- [ ] Add automated screen-reader and OS-native accessibility acceptance checks.
- [ ] Complete signed-release, provenance, and update-channel implementation. The v0.1.0 Developer
  Preview now has a release checklist, CycloneDX SBOM/checksum scripts, packaged-license smoke, and
  explicit evidence boundaries; signing/notarization and provenance remain deliberately unclaimed.
- [ ] Replace or upgrade Expo/Metro's transitive `image-size` dependency when
  an upstream release resolves the current ICNS/JXL/HEIF parser DoS advisories;
  do not force an unverified package override into the SDK 57 toolchain.
- [x] Consume an authenticated, allowlisted mobile SSE projection for low-latency agent updates,
  reconcile from bootstrap after each connection, pause in the background, and reconnect with
  bounded backoff.
- [ ] Add push/background notification delivery for completed and Needs-you work; the phone must not
  pretend a foreground poll runs while the app is suspended.
- [x] Wire bounded paired-host attachment upload with best-effort rollback, least-privilege mobile
  bot creation, mark-read updates, and a capability-gated read-only computer preview.
- [x] Add older-message pagination with cursor-based loading and stable anchored rendering.
- [ ] Add voice input backed by an Expo SDK 57-compatible native module,
  and paired-host routine editing without widening provider or device-administration access.

## Explicitly deferred

- AI-generated avatar imagery is deferred. The current Generate tab selects a Mote shape, color,
  and motion locally; it does not call an image model or upload a prompt.
- Overlapping Windows branches will not be merged wholesale. Useful ideas will be reimplemented on
  one reviewed portability foundation.
- Native Linux/Windows computer-use and dictation are deferred until they have platform-specific
  backends and hands-on evidence; current preview builds expose honest unavailable states.
- Provider drivers that require blanket approval will not become defaults.
- Laptop-off execution requires the user to keep Cumea running on their own authenticated always-on
  host. Cumea does not provide a managed VM, and pairing a phone does not move provider execution.
- “Teach as routine” reuses a completed task and its audited run; recording arbitrary human desktop
  demonstrations and replaying them safely still needs a dedicated recorder and consent model.
- Production mobile distribution remains deferred until signed physical-device and notification
  tests exist. The source companion, pairing, revocation, and least-privilege remote API are present;
  that is not equivalent to an App Store or Play Store-ready release.

This roadmap is a starting point, not a promise of compatibility. New feature proposals should
state the user problem, consent model, third-party data flow, platform scope, and verification plan.
