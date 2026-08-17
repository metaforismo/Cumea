# Changelog

All notable changes to Cumea are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning.

## [Unreleased]

### Added

- An opt-in packaged desktop performance runner with isolated first-run and returning profiles,
  deterministic no-provider fixtures, explicit cache treatment, multi-sample median/p95 evidence,
  bounded logs, process-tree timeouts, and versioned manifests. No benchmark result is claimed until
  the same scenarios are run as a trend series on one labelled fixed machine.

### Security

- Packaged Electron credentials now use an allowlisted, versioned vault encrypted through the
  operating-system credential service. Legacy plaintext is removed only after successful encrypted
  migration; unavailable/corrupt storage preserves the recovery source while the packaged harness
  starts without credentials instead of silently reusing or rewriting plaintext.
- Packaged credential values remain write-only to the renderer, are supplied only to a fresh harness
  bootstrap, and are removed from the harness environment before provider child processes load.
  Credential changes restart the harness and roll the encrypted/live state back when restart fails.
- Source/browser hosting retains the explicit owner-only `config.json` fallback. The unsigned package
  smoke verifies layout only and does not yet prove Keychain, DPAPI, Linux secret-service, signing,
  notarization, or physical-machine behavior.

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
