# Changelog

All notable changes to Cumea are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning.

## [Unreleased]

## [0.2.0] - 2026-08-13 — Developer Preview Candidate

### Added

- 24-hour Quick bots with conservative expiry gates and one-click conversion to a permanent agent
  on desktop or a paired phone.
- Clickable agent workspace paths and attachment cards backed by short-lived opaque capabilities,
  with integrated bounded Markdown, PDF, and semantic DOCX previews.
- Native iOS/Android message dictation with editable partial results, explicit permission states,
  and foreground-only capture.
- An accessible jump-to-latest affordance in mobile chat when new messages arrive while someone is
  reading older history.
- An Opencrew-inspired, source-first landing page for the self-hosted project.

### Changed

- Batched high-frequency streaming deltas and event-log writes while retaining ordered flushes at
  message and turn boundaries; mobile chat keeps cursor pagination and anchored rendering instead
  of adding an unproven virtualization dependency.
- Strengthened desktop speech-session cleanup so late native-helper output cannot enter a newer
  composer session.
- Expanded the release SBOM to inventory the exact Electron runtime used by the packaged desktop
  application, in addition to the production dependency graph and pinned CUA Driver executable.

### Security

- Confined file previews to validated per-agent workspaces, same-origin capability URLs, bounded
  snapshots, non-executable document parsing, and atomic bot/file lifecycle handling.
- Added ZIP metadata, decompressed-byte, CRC, and active-content checks to the semantic DOCX parser.
- Kept Quick bots from expiring while work, approvals, provider requests, or routines remain live.

### Release evidence boundary

- `v0.2.0` is a **Developer Preview candidate**, not a production-support claim, and has not been
  tagged or published by this change.
- The first binary target remains macOS arm64. An unsigned package-layout smoke does not establish
  launch behavior, code signing, notarization, Gatekeeper acceptance, or update-channel safety.
- Linux and Windows receive portable source checks only until hands-on package and desktop testing
  is recorded. Desktop local-computer control and desktop dictation remain macOS-only; mobile
  dictation requires an iOS/Android development or distribution build rather than Expo Go.
- No iOS/Android signed build, physical-device, VoiceOver/TalkBack, push/background, or store review
  is claimed.
- A release must not be tagged or published until the exact candidate commit satisfies
  [the release checklist](docs/releasing.md). Results from a dirty checkout or another commit are
  not release evidence.

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

[Unreleased]: https://github.com/metaforismo/Cumea/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/metaforismo/Cumea/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/metaforismo/Cumea/releases/tag/v0.1.0
