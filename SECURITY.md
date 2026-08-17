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

## Desktop credential storage

The packaged Electron desktop encrypts optional provider/app credentials with
Electron `safeStorage`. The renderer receives only configured booleans and
non-secret storage status. It never receives stored values. Migration from
legacy `~/.cumea/config.json` plaintext writes the encrypted vault first and
removes plaintext only after that succeeds.

If the operating-system credential service is unavailable or the encrypted
vault is corrupt, legacy plaintext is retained as a recovery source but the
packaged harness starts with an empty managed credential set. New packaged
credential writes fail closed rather than falling back to plaintext. Source and
browser-host operation retains the documented owner-only file fallback because
there is no Electron main process to own an OS vault.

In packaged managed mode, credential-shaped writes to `/api/config` are
rejected; the narrow Electron IPC method is the only valid write or clear path.
The harness receives an allowlisted one-process bootstrap, overrides ambient
dedicated fields, and deletes them from `process.env` before provider instances
or provider child processes are created. Plaintext credential aliases in
advanced instance environments are ignored. xAI and Box credentials are
mounted only into their owning API/Box drivers. Composio credentials remain in
the harness until an apps-enabled turn explicitly mounts them into a driver
that advertises Composio MCP support; unrelated or ineligible turns do not
receive them.

A credential candidate is first validated in a fresh harness and must match the
exact configured flag before the encrypted vault is replaced. The prior vault
remains untouched during validation and is the transaction anchor. Candidate
failure, confirmation mismatch, or secure-storage commit failure restores the
previous in-memory bootstrap and harness. If that previous harness cannot
recover and confirm, Cumea requires a full restart instead of presenting an
ambiguous state as restored. Full behavior and recovery guidance are documented
in [Desktop credential storage](docs/credential-storage.md).

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use
[GitHub private vulnerability reporting](https://github.com/metaforismo/Cumea/security/advisories/new)
so reports, reproduction details, and fixes remain confidential until coordinated disclosure.

## Scope notes for researchers

- The desktop harness listener binds **127.0.0.1 only** and has no authentication by design — it
  trusts the local user. The separately enabled mobile listener must require a valid device token
  on every non-pairing request. Any other path that makes the local API reachable off-machine, or
  lets one local *unprivileged other user* drive it, is a vulnerability.
- Packaged credentials live in the OS-backed encrypted vault; source/browser credentials may use
  owner-only `~/.cumea/config.json`. Both surfaces are write-only (`configured` booleans out, never
  values). Any path that echoes a stored secret back — API response, SSE event, renderer state,
  diagnostic, log line, command-line argument visible in `ps`, or unrelated provider environment —
  is a vulnerability.
- In packaged managed mode, bypassing the Electron vault through `/api/config`, an ambient bootstrap
  variable, or an advanced instance environment is a vulnerability. A credential supplied to one
  provider or explicitly mounted integration must not be inherited by an unrelated provider process
  or turn.
- A packaged app must not consume preserved legacy plaintext while secure storage is blocked, nor
  silently downgrade to Electron's Linux `basic_text` backend. Migration must not erase the legacy
  source before a decryptable encrypted replacement exists.
- A credential update must not commit the candidate vault until the restarted harness confirms the
  expected configured flag. Failed validation or persistence must leave the prior encrypted vault
  authoritative and either restore its harness state or visibly require restart.
- Agents run real CLIs (`claude`, `codex`) with the user's own privileges, and the permission broker
  is the consent layer for risky actions. Bypasses of the broker (approving without a user decision,
  spoofing the broker socket) are vulnerabilities.
- Spawning must never route user-influenced strings through a shell. Report any `shell: true` /
  `cmd.exe` string-building you find.

The OS-backed vault is not a sandbox against malicious code already running as the same user. A
compromised Electron main process or harness process, memory inspection with equivalent privileges,
or a provider process or integration legitimately receiving its own credential remain outside this
protection boundary.

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
