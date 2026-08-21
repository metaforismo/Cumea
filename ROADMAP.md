# Cumea roadmap

This is the bootstrap backlog as of 2026-08-14. It is deliberately ordered: reliability, privacy,
and consent come before provider count or visual expansion.

## P0 — trustworthy foundation

- [x] Deterministic, UTF-8-bounded replay context compaction with active-branch provenance and honest structural estimates.

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
- [x] Add a raw-request regression test for encoded static traversal attempts.
- [x] Persist every operational message as a task/run with tool steps, approval state, handoffs,
  artifacts, failure recovery, and bounded history.
- [x] Replace the placeholder routine UI with durable interval/daily/weekly schedules, pause,
  run-now, due dispatch, failure history, and “Teach as routine”.
- [x] Add a “Needs you” approval inbox and remembered per-bot Ask / Always / Never policies.
- [x] Keep unresolved provider decisions at the composer as one focused oldest-first surface, with
  read-only transcript history, preserved drafts, commit-on-success answers, and retryable failures.
- [x] Scope Box, xAI, Composio, Expo, and Cumea capability credentials to their owning adapters;
  run user-configured Custom ACP children with a minimal host environment while documenting that
  environment filtering is not an operating-system sandbox.
- [x] Share one bounded Markdown URL/control-character and streaming-fence policy between desktop
  and mobile without widening desktop file capabilities or giving mobile local-path access.
- [x] Add an opt-in authenticated mobile listener with expiring single-use pairing, hashed device
  tokens, local revocation, allowlisted mobile projections, and sanitized SSE events.

## P1 — usability and portability

- [x] Reimplement API-key setup guidance with accessible provider-specific billing and data-flow copy
  ([upstream PR #27](https://github.com/milind-soni/OpenMausBot/pull/27)).
- [ ] Rebase the Linux desktop work onto Cumea's hardened core; validate both Xorg and Wayland
  before calling it supported ([upstream PR #32](https://github.com/milind-soni/OpenMausBot/pull/32)).
- [x] Build one shared platform abstraction for executable shims, process trees, authenticated
  sockets/named pipes, PATH handling, and native title-bar controls. The implementation selectively
  adapts the useful merged work from
  [upstream PR #17](https://github.com/milind-soni/OpenMausBot/pull/17); hands-on Windows package
  acceptance remains a separate open gate.
- [x] Let each bot select a different local subscription/model through validated configurable ACP
  profiles, while leaving sign-in, quotas, and billing with the user-installed CLI
  ([upstream issue #28](https://github.com/milind-soni/OpenMausBot/issues/28)).
- [x] Add a desktop-local privacy/settings inventory showing which integrations are enabled and
  where data can go, with allowlisted data categories, trigger/consent/storage boundaries, honest
  CLI uncertainty, redacted runtime-derived status, and authenticated-mobile exclusion verified by
  a real loopback HTTP test.
- [x] Make sidebar search functional and add persistent sections with create, rename, delete, and
  bot assignment flows.
- [x] Re-probe the existing provider inventory on renderer focus with a monotonic throttle,
  in-flight deduplication, cleanup, and last-known-snapshot preservation on failure.
- [x] Add bounded local attachments with task artifacts and audited HTTP upload/download/delete.
- [x] Add full-workspace and selective per-agent backup with a versioned integrity manifest,
  secret/session exclusions, bounded dry-run validation, same-volume atomic restore, rollback, and
  a retained pre-restore snapshot. Administrative restore remains desktop-local.
- [x] Resolve agent-produced paths only inside per-agent workspaces and render bounded Markdown,
  PDF, semantic DOCX, and static HTML previews through short-lived capabilities. HTML remains an
  opaque-origin, non-interactive surface with scripts, network, forms, navigation, popups, and
  downloads disabled; uploaded HTML stays download-only.
- [x] Add 24-hour Quick bots with conservative expiry blockers and explicit conversion to a
  permanent agent on desktop or a paired phone.
- [x] Add a host-local Box auto-sleep cost guard with per-agent timers, activity reconciliation,
  turn/queue/routine/approval/screen/resource/delete blockers, configurable Off/10/30/60 minute UI,
  and no provider retry loop after an unconfirmed request.
- [x] Add desktop routine details with write-only prompt replacement, lossless multi-attempt history
  from canonical task/run records, next occurrences, IANA/DST-safe schedule editing, and multi-day
  weekly round-trips.
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

- [x] Add a local out-of-process ACP profile contract with exact argument vectors, configurable
  model catalogs, explicit consent mode, and automatic peer-agent MCP mounting. A broader signed
  plugin marketplace remains intentionally out of scope.
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
- [ ] Complete signed-release, provenance, and update-channel implementation. The published v0.1.0
  Developer Preview established the source-only baseline; the v0.2.0 candidate extends its release
  checklist, CycloneDX SBOM/checksum scripts, packaged-license smoke, and explicit evidence
  boundaries. Signing/notarization and provenance remain deliberately unclaimed.
- [ ] Replace or upgrade Expo/Metro's transitive `image-size` dependency when
  an upstream release resolves the current ICNS/JXL/HEIF parser DoS advisories;
  do not force an unverified package override into the SDK 57 toolchain.
- [x] Consume an authenticated, allowlisted mobile SSE projection for low-latency agent updates,
  reconcile from bootstrap after each connection, pause in the background, and reconnect with
  bounded backoff.
- [x] Add opt-in push/background notification delivery for completed and Needs-you work, with
  per-device pairing tokens, bounded payloads, Expo batching/receipts, revocation, and deep links.
  Physical APNs/FCM delivery remains a signed-device release gate, not a source-level claim.
- [x] Wire bounded paired-host attachment upload with best-effort rollback, least-privilege mobile
  bot creation, mark-read updates, and a capability-gated read-only computer preview.
- [x] Preserve privacy-projected agent handoffs as bounded structured mobile cards, with textual
  status and navigation only while the destination remains in the visible roster.
- [x] Add older-message pagination with cursor-based loading and stable anchored rendering.
- [x] Add non-destructive message editing with durable parent-linked branches, legacy transcript
  migration, safe provider-session replay, accessible version switching, and desktop/mobile SSE
  synchronization ([upstream PR #45](https://github.com/milind-soni/OpenMausBot/pull/45)).
- [x] Add bounded durable per-agent message queues and explicit clean task-context boundaries so a
  long-running named agent can accept later work without interrupting or contaminating its active
  turn.
- [x] Convert long pasted text into bounded UTF-8 attachments and accept file drops through the
  same ownership, quota, rollback, and deletion contracts as picker uploads.
- [x] Keep the newest edge stable during live updates and show an accessible new-message affordance
  when someone is reading older history instead of forcing a scroll jump.
- [x] Add editable native dictation backed by an Expo SDK 57-compatible module, including bounded
  lifecycle cleanup and honest Expo Go/platform error states. Physical-device permission and
  accessibility acceptance remain part of the release gate above.
- [x] Add paired-host routine editing with an exact field allowlist, hidden-agent ownership checks,
  and no provider, verification-policy, or device-administration access.
- [ ] Profile long streaming Markdown and global state fan-out in release builds on physical iOS
  and Android devices before changing list engines or adding another virtualization dependency.
  Desktop token deltas now live in a paint-batched context separate from durable app state; mobile
  already batches deltas and uses cursor-paged, anchored FlatList rendering.
- [x] Add strict durable per-task budgets for active execution time, canonical tool/computer/
  delegation events, and provider token deltas only when trustworthy telemetry is available.
- [x] Add an optional revisioned memory-provider contract with per-revision provenance, bounded
  search/context, retention, optimistic conflicts, hard deletion, exact successful-use accounting,
  and opt-in permissioned agent writes; connectors do not become opaque memory automatically.
- [x] Add selective local MCP management with exact stdio argv, write-only environment values,
  owner-only persistence, provider capability gates, and explicit per-agent assignment.
- [x] Add confined, versioned, instruction-only local skill packages with strict provenance,
  explicit assignment/update/rollback, and no executable or network-install surface. Signed and
  executable package formats remain separate future designs.
- [x] Add one exclusive workspace Coordinator that uses the existing visible peer-agent handoff,
  permission, depth, and accounting boundaries and fails closed when peer tools are unavailable.
- [x] Add objective completion evidence and explicit resumable checkpoints within the existing
  audited task/run state machine, with mobile-safe projections and uncertain effects blocking resume.

## Explicitly deferred

- AI-generated avatar imagery is deferred. The current Generate tab selects a Mote shape, color,
  and motion locally; it does not call an image model or upload a prompt.
- Overlapping Windows branches will not be merged wholesale. Useful ideas will be reimplemented on
  one reviewed portability foundation.
- Native Linux/Windows computer-use and dictation are deferred until they have platform-specific
  backends and hands-on evidence; current preview builds expose honest unavailable states.
- Provider drivers that require blanket approval will not become defaults.
- Laptop-off execution requires the user to keep Cumea running on their own authenticated always-on
  host. Cumea does not provide a managed cloud VM. The optional Local VM is a Cua desktop container
  on that same host; pairing a phone does not move provider execution or keep the host online.
- “Teach as routine” reuses a completed task and its audited run; recording arbitrary human desktop
  demonstrations and replaying them safely still needs a dedicated recorder and consent model.
- Production mobile distribution remains deferred until signed physical-device and notification
  tests exist. The source companion, pairing, revocation, and least-privilege remote API are present;
  that is not equivalent to an App Store or Play Store-ready release.

This roadmap is a starting point, not a promise of compatibility. New feature proposals should
state the user problem, consent model, third-party data flow, platform scope, and verification plan.
