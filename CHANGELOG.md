# Changelog

All notable changes to Cumea are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning.

## [Unreleased]

### Added

- Added an app-wide interaction accessibility baseline for keyboard-visible focus, branded text
  selection, reduced-motion scrolling, and decorative panel/pop transitions. Existing semantic Mote
  working/waiting state remains visible when animation is reduced; a real-browser acceptance journey
  is still required before treating P0.09a as complete.
- An opt-in packaged desktop performance runner with isolated first-run and returning profiles,
  deterministic no-provider fixtures, explicit cache treatment, multi-sample median/p95 evidence,
  bounded logs, process-tree timeouts, and versioned manifests. No benchmark result is claimed until
  the same scenarios are run as a trend series on one labelled fixed machine.
- Packaged desktop startup now has a stable Electron-owned loopback UI/API gateway. The renderer can
  paint the packaged shell before provider discovery and harness readiness, while API/SSE traffic is
  attached only to a verified local harness. The renderer origin remains stable so origin-scoped
  local state does not reset between launches.
- Local computer initialization is now lazy: normal startup writes a harmless unavailable descriptor
  without loading the CUA SDK, reading TCC state, probing the local socket, or starting the native
  daemon. Actual reconciliation happens when the capability is inspected or requested.
- Desktop state now has a versioned, bounded local bootstrap snapshot with a monotonic SSE cursor.
  Startup and reconnect buffer concurrent deltas, hydrate bots/configuration/engines/work state once,
  discard events already represented by the snapshot, and re-snapshot rather than guessing after a
  bounded-buffer overflow.
- Added an owner-local derived SQLite/WAL transcript search index and local-only bounded search API.
  It incrementally follows visible folded messages, excludes raw/provider-private fields, reconciles
  against canonical transcript fingerprints after crashes, and keeps canonical JSON as the recovery
  source until P0.11b.
- Added the P0.11b canonical transcript database foundation: owner-local `transcripts.sqlite`,
  verified all-or-nothing legacy import with SHA-256 provenance, stable message ordering, per-thread
  revisions, incremental append/patch primitives, reversible pending deletion, crash reconciliation,
  and independently readable `VACUUM INTO` backups.
- Activated canonical transcript persistence in the real harness. Folded history now reads, appends
  and patches through owner-local `transcripts.sqlite` without whole-thread JSON rewrites; existing
  legacy JSON remains an immutable migration/recovery anchor until its bot is deleted, and new bots
  create no JSON transcript. The derived search index reconciles against canonical revisions.
- Added global desktop transcript search to the existing agent search field, bounded exact-message
  navigation with highlighted focus and Return to latest, plus bounded Markdown/JSON visible-transcript
  export. Search jumps do not load entire long conversations.
- Added a desktop-local per-thread Runtime inspector over the existing normalized event stream and
  secret-redacted native protocol tee, with bounded Events/Raw lenses, expandable JSON and periodic refresh.
- Added attended busy-user steering on desktop and paired mobile. Explicit user messages can be queued while
  an agent works, with visible delivery state, bounded count/text/attachment budgets and one coalesced follow-up.
- Added lifecycle-aware Work projections (`working`, `waiting`, `no-signal`, `dead`) with waiting-on-human
  exemptions, bounded repeated-identical effect alerts and visible recovery in Work / Needs You.

### Changed

- Native provider continuation is now dispatch-fresh rather than cursor-presence based. A→B→A routing,
  provider reloads, interrupted dispatches and unsupported in-session model changes rebuild bounded canonical
  conversation context in a fresh native session instead of trusting stale provider state.
- Re-audited Cumea `ea3d751b` against Rakazo `c3d386d8` and OpenMausBot `70805c0a` after P0.12.
  Newly explicit gaps are Agent→Conversations separation, owner-local bounded history compaction,
  steady-state typing/streaming/idle evidence, resilient mobile host-candidate rotation, BYO-VPS, and
  fenced Team/Private computer sessions. Cumea keeps SQLite/local identity as the default and does not
  adopt mandatory Better Auth/Postgres, hosted memory, or a Cumea-operated control plane.
- P0.03 now keeps the stable renderer gateway while the packaged harness uses an OS-assigned private
  port. Readiness is published over a versioned exact-PID UtilityProcess message instead of HTTP
  polling/fixed fallback ports. The optional remote listener keeps an independent explicit/default
  port. No startup performance improvement is claimed before fixed-machine evidence exists.

### Security

- Lifecycle detection is advisory and never kills a provider solely because a timer elapsed. Real provider
  approvals/questions own a separate attention state and are exempt from silence/dead thresholds; ordinary
  heartbeats stay process-local so the watchdog does not amplify durable Workspace writes.
- Busy steering uses canonical owner-local transcript state rather than a second queue. The selected batch is
  atomically claimed as `dispatching` before external provider work; queued, dispatching and failed steering
  rows are excluded from unrelated provider context. Ambiguous crash/reload state fails closed instead of
  automatically replaying instructions or effects.
- Session freshness metadata is owner-local and contains only thread/instance/model lifecycle state. Rebuilt
  conversation history is size-bounded and quoted inside the next user turn, never promoted into the system
  prompt; native drivers independently refuse any supplied resume cursor while rebuild is required.
- Runtime/Raw diagnostics remain desktop-local and `no-store`; they are excluded from bootstrap,
  transcript search/export and paired mobile routes. Normalized events drop `RuntimeEvent.raw`, while
  native payloads are bounded before entering renderer state and large records become omission previews.
- Exact transcript navigation and export remain desktop-local. Export projects only folded visible fields:
  raw screen bytes, provider-native/request identifiers, attachment IDs, resume cursors and filesystem paths
  are excluded; screenshot messages are represented only by an explicit omission marker.
- Canonical bot deletion is a rollback-capable cross-store transaction: SQLite first enters
  `pending_delete`, commits and privacy-checkpoints the transcript while retaining an exact private
  rollback snapshot, then outer bot/workspace/file purges run, and only a successful full purge releases
  that snapshot. Metadata, search, legacy-anchor, checkpoint and post-commit purge failures are tested.
- Canonical transcript import is fail-closed: malformed legacy roots/messages or duplicate message IDs
  never create a partial thread. `pending_delete` freezes reads and mutations while retaining bytes for
  rollback, and interrupted pending deletes can be reconciled against the authoritative bot roster.
- Transcript-index deletion is privacy-sensitive: the derived DB is owner-only, uses SQLite
  `secure_delete`, requires a WAL truncate checkpoint for thread deletion, fails closed if a
  residual index cannot be opened, and restores indexed rows when the surrounding bot deletion
  transaction rolls back. The search endpoint remains desktop-local only.
- The packaged desktop gateway binds loopback only, requires its exact numeric loopback `Host`,
  constrains decoded static paths, strips static and connection-named hop-by-hop headers, reasserts
  security headers, and translates only its own renderer Origin. The OS-assigned private harness
  listener now also validates its exact local Host/origin boundary before serving requests.
- Harness target state is cleared during restart, unexpected child exit, and shutdown so renderer
  traffic cannot remain pointed at an unverified or later-reused local port. A shutdown latch prevents
  asynchronous startup from spawning another fallback child while the app is quitting.
- Packaged Electron credentials now use an allowlisted, versioned vault encrypted through the
  operating-system credential service. Legacy plaintext is removed only after successful encrypted
  migration; unavailable/corrupt storage preserves the recovery source while the packaged harness
  starts without credentials instead of silently reusing or rewriting plaintext.
- Packaged credential values remain write-only to the renderer. Credential-shaped writes to the
  ordinary managed config API are rejected, ambient and advanced-instance credential aliases cannot
  override the vault, bootstrap fields are removed before providers load, and credentials are
  mounted only into owning providers or explicitly capable integrations.
- Credential changes validate an in-memory candidate in a fresh harness and require the exact
  configured flag before atomically committing the vault. Failed validation or persistence leaves
  the prior encrypted vault authoritative and restores its live harness state when possible.
- Source/browser hosting retains the explicit owner-only `config.json` fallback. The unsigned package
  smoke verifies layout only and does not yet prove Keychain, DPAPI, Linux secret-service, signing,
  notarization, migration on a real prior profile, or physical-machine behavior.

## [0.1.0] - 2026-08-13 — Developer Preview

### Added

- Persistent named agents with Claude, Codex, Grok, Gemini, and Box-backed provider adapters.
- Agent-to-agent handoffs, durable tasks/runs/tool steps/artifacts, reusable routines, and a
  consolidated Needs-you approval inbox.
- Local macOS and optional user-provided cloud computer surfaces, plus optional connected-app
  actions through Composio.
- A self-hosted Expo companion with secure one-time pairing, an agent-list home, per-agent chat,
  approvals, routine status, attachment upload, revocation, and capability-gated screen preview.
- Persistent customizable Mote-based avatars with semantic working, waiting, success, and error
  states, including reduced-motion behavior.
- Linux and Windows preview packaging configuration with explicit feature degradation.

### Security

- Removed upstream telemetry and remote identity collection.
- Hardened local HTTP boundaries, navigation, external links, JSON/static-file handling, secret
  projection, provider process spawning, configuration permissions, and atomic persistence.
- Kept remote/mobile access opt-in, separately authenticated, least-privilege, and documented for
  deployment only behind user-controlled HTTPS or a private tunnel.

### Release evidence boundary

- `v0.1.0` is a **Developer Preview**, not a production-support claim.
- The first binary target is macOS arm64. CI may build an unsigned unpacked app to verify package
  contents, but that does not prove launch behavior, code signing, notarization, or Gatekeeper
  acceptance.
- Linux and Windows receive portable source checks only until hands-on package and desktop testing
  is recorded. Local computer control and dictation remain macOS-only.
- The Expo typecheck and JavaScript export are source-distribution checks. No iOS/Android signed
  build, physical-device, VoiceOver/TalkBack, push/background, or store review is claimed.
- A release must not be tagged or published until the exact candidate commit satisfies
  [the release checklist](docs/releasing.md). Results from a dirty checkout or another commit are
  not release evidence.

[Unreleased]: https://github.com/metaforismo/Cumea/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/metaforismo/Cumea/releases/tag/v0.1.0
