# Changelog

All notable changes to Cumea are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning.

## [Unreleased]

### Added

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

### Changed

- Re-audited current Rakazo and OpenMausBot engineering at pinned commits and folded only compatible
  ideas into Cumea's roadmap: incremental local transcript persistence/search, liveness and loop
  protection, renderer/thread scaling, inspectable memory, visual journey evidence, and pluggable
  user-owned computer backends. Mandatory hosted identity/control-plane assumptions remain out of
  scope for the local default.
- P0.03 now keeps the stable renderer gateway while the packaged harness uses an OS-assigned private
  port. Readiness is published over a versioned exact-PID UtilityProcess message instead of HTTP
  polling/fixed fallback ports. The optional remote listener keeps an independent explicit/default
  port. No startup performance improvement is claimed before fixed-machine evidence exists.

### Security

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
