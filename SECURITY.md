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

The privacy/data-flow inventory is a desktop-local administrative projection assembled from a
fixed row and copy allowlist plus current host booleans. It never returns credentials, environment
values, endpoint URLs, host paths, prompts, filenames, configured labels, provider-instance IDs,
device identities, or hidden-agent state, and it is absent from mobile bootstrap and SSE. Its
`available` state means local prerequisites were detected, not that a third-party network, account,
retention policy, or separately installed CLI was verified.

Paired devices may answer the currently displayed permission or question, but
they cannot list, create, or revoke remembered approval rules. Their approval
choices are projected as one-shot Allow/Deny actions.

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
- Remembered decisions are keyed by normalized tool identity and, for command surfaces, program.
  They are persisted only after the provider accepts the current response. Questions, malformed or
  composed commands, destructive/secret/privileged operations, interpreters, and transfer tools
  cannot use a remembered allow rule. Legacy per-bot blanket policies migrate to no grants.
- Spawning must never route user-influenced strings through a shell. Report any `shell: true` /
  `cmd.exe` string-building you find.

## Configurable ACP profiles

Custom ACP profiles are a local desktop administration surface and are not exposed to paired
devices. A profile names an executable plus an exact argument array; Cumea never concatenates those
values into a shell command. Profiles deliberately do not accept environment variables, API keys,
or tokens. Authentication should be completed in the provider CLI itself because command-line
arguments can be visible to other local processes.

Adding a profile authorizes that local executable to run with the same operating-system privileges
as Cumea and to receive that bot's prompts and enabled tool bridges. Only install and configure CLIs
you trust. `Always approve tool requests` is an explicit high-trust choice; it is never inferred
from the provider or enabled merely because an upstream adapter defaults to full-auto.

Unsent desktop text drafts are best-effort local browser storage keyed by agent. They are never sent
to a provider or paired phone until the user submits them, and empty/sent drafts are removed. They
are not encrypted independently from the local user account; do not leave sensitive unsent text on
a host shared with another person using the same operating-system session.

Backup export and restore are local desktop administration surfaces and are never projected to a
paired device. Archives exclude application-managed API keys, MCP environment values, paired-device
and push credentials, custom executable profiles, browser/provider sessions, provider resume
cursors, and remembered automatic-approval authority. Known stored secrets are redacted from
exported JSON, while credential-like or matching files in agent workspaces are skipped after a
complete bounded byte scan. User documents and binary attachments can still contain sensitive
information by intent; inspect them before sharing an archive.

Runtime egress uses one bounded server-side secret catalog assembled from explicit credential
fields (provider configuration, sensitive ACP/MCP/computer environments, active push and internal
capabilities). Provider events are redacted before the canonical diagnostic log and before any
subscriber can persist or broadcast them; HTTP errors and SSE receive the same safe projection.
Exact known credentials and narrowly defined high-confidence token formats are removed, while short
or ordinary profile/model/path text is not treated as secret authority. Rotation replaces the
catalog atomically. This is an egress control, not at-rest encryption: protect the host account and
the owner-only data directory as well.

Restore treats every archive as hostile: paths, versions, counts, expanded sizes, ownership links,
and SHA-256 digests are validated before writes. A same-filesystem staging directory is swapped into
place only while the maintenance gate proves no active turn or scheduler can race it. Excluded event
and native-provider logs are cleared so old runtime history cannot attach to restored identities.
Failure restores the previous directory, and a successful operation retains that directory as a
pre-restore backup. See [Backup and restore](docs/backup-and-restore.md) for the portable-data boundary.

Persisted JSON is loaded with bounded, schema-aware, no-symlink semantics. Missing first-run state is
normal; malformed, oversized, unsupported, unreadable, non-regular, or invalid state is not silently
replaced with an empty store. Its writes remain blocked while the local desktop exposes only safe
diagnostic metadata. An explicit filename-confirmed reset first preserves the original bytes with
owner-only permissions and atomically stages a replacement, then requires a restart before writes
can resume. Paired devices cannot inspect or administer persistence recovery. See
[Backup and restore](docs/backup-and-restore.md#corrupt-local-persistence).

Unexpected restarts convert active runs to `interrupted`. Resume is an explicit local-desktop action
and is blocked by an applying or unknown external effect. Provider-native continuation is accepted
only after instance, model, active transcript leaf, capability, and private-cursor digest match; the
checkpoint never contains the raw cursor. See [Resumable run checkpoints](docs/resumable-checkpoints.md).

Generated HTML can be previewed only after Cumea snapshots a bounded, complete UTF-8 document from
that agent's owned local or cloud workspace into a short-lived capability. The preview is local-only
and uses an opaque-origin iframe with no sandbox permissions. Response CSP and Permissions Policy
deny scripts, network, forms, nested frames, workers, objects, navigation, device APIs, clipboard,
and ambient referrers; the UI also disables pointer and keyboard interaction. `http-equiv` metadata
is rejected to prevent parser-triggered refresh navigation. Uploaded HTML remains download-only, and
deleting an agent revokes its outstanding preview capabilities. Treat raw downloads as untrusted
files and open them outside Cumea only when you trust their source.

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

The same audit reports `uuid@7.0.3` through `@expo/config-plugins` → `xcode@3.0.1`.
The advisory affects the v3/v5/v6 APIs when a caller supplies an output buffer;
the installed `xcode` package calls only `uuid.v4()` without a buffer. That makes
the vulnerable operation unreachable in the current dependency path, but it
does not make the advisory disappear. Keep the finding visible and upgrade with
Expo's supported dependency graph instead of forcing a cross-major override.
