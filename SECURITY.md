# Security Policy

## Self-hosted mobile access

Remote access is off by default and uses a separate authenticated listener.
Deployment requirements, pairing guarantees, exposed endpoints, and revocation
are documented in [Self-hosted mobile access](docs/self-hosted-mobile.md).
Never expose the raw HTTP listener to the public internet; terminate HTTPS at a
trusted reverse proxy or secure tunnel.

Read-only computer preview is disabled unless
`CUMEA_REMOTE_SCREEN_PREVIEW=1` is set. Enabling it lets every active paired
device read the latest already-captured, bounded PNG/JPEG frame. It does not
enable computer control or on-demand capture, but screenshots can still contain
sensitive data; enable it only on a host whose paired devices are trusted.

The mobile API and SSE stream are explicit projections rather than serialized
local state. Hidden bots, provider errors, system prompts, model reasoning,
provider-native request details, raw screen frames, and configuration fields
remain local. Conversation messages and handoff prompts are available to the
paired device. To make `Needs you` actionable, an approval card also exposes its
minimum title, subtitle, options, request identifier/type, and tool name to an
authenticated paired device. Authenticated uploads are capped at 25 MiB each
and at a persistent 100-file / 250-MiB quota per bot.

Pairing credentials are never accepted from an operating-system custom-scheme
launch URL. The `cumea://pair` string is only a transport format for the
app's own QR scanner or an explicit paste, because another installed app could
otherwise register the same custom scheme and intercept the one-time secret.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use
[GitHub private vulnerability reporting](https://github.com/metaforismo/Cumea/security/advisories/new)
so reports, reproduction details, and fixes remain confidential until coordinated disclosure.

## Scope notes for researchers

- The desktop harness listener binds **127.0.0.1 only** and has no authentication by design — it
  trusts the local user. The separately enabled mobile listener must require a valid device token
  on every non-pairing request. Any other path that makes the local API reachable off-machine, or
  lets one local *unprivileged other user* drive it, is a vulnerability.
- API keys live in `~/.cumea/config.json` and are write-only through the API (`configured`
  booleans out, never values). Any path that echoes a stored secret back — API response, SSE event,
  log line, argv visible in `ps` — is a vulnerability.
- Agents run real CLIs (`claude`, `codex`) with the user's own privileges, and the permission broker
  is the consent layer for risky actions. Bypasses of the broker (approving without a user decision,
  spoofing the broker socket) are vulnerabilities.
- Spawning must never route user-influenced strings through a shell. Report any `shell: true` /
  `cmd.exe` string-building you find.

## Supported versions

Until the first stable release, security fixes are made on `main`. Published releases will receive
a documented support window before Cumea is presented as production-ready.

## Known dependency advisory

The Expo SDK 57 development/export toolchain currently reaches
`image-size@1.2.1` through Metro. npm reports ICNS and JXL/HEIF parser
denial-of-service advisories for all published versions and lists no patched
release. Cumea does not accept those formats through its mobile attachment
preview or remote computer-preview decoder, but Metro may parse repository
image assets during development/export. Use trusted project assets and update
Expo/Metro as soon as upstream ships a corrected dependency; an unverified
override is not applied here.
