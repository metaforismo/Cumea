# Backup and restore

Cumea can export the entire local workspace or one agent from **Settings → Backup & restore**.
The resulting ZIP is a portable data archive, not a clone of the host. Before using it, Cumea
performs a dry-run that verifies its versioned manifest, every declared path, expanded byte count,
per-file and total quotas, and the SHA-256 digest of every payload.

## Included data

- Agent records without busy state, provider resume cursors, or MCP assignments.
- Conversation branches, tasks, runs, portable external-effect audit receipts, routines, sections,
  revisioned memory, and attachments.
- Regular files from the selected agents' managed workspaces.
- The non-secret local profile for a full-workspace backup.

Credential-like workspace filenames, private-key/token-shaped text files, symlinks, oversized
files, and files containing a credential already known to Cumea are skipped. The preview reports
the skipped count. This filter is a defensive boundary for application-managed secrets, not a
general secret scanner: review user-authored documents before sharing a backup with someone else.

## Deliberately excluded

- API keys, provider credentials, CLI/browser sessions, and provider-native resume cursors.
- MCP executable/environment configuration and custom ACP executable profiles.
- Remembered approval rules and the legacy global approval policy.
- Paired-device credentials, one-time pairing sessions, and push tokens.
- Native runtime state and raw event logs.
- External-effect request/response bodies, destination credentials, and replay authority.

Those values remain local to the destination host. Restoring on another machine therefore requires
reconnecting providers, MCP servers, ACP profiles, and mobile devices.

## Restore safety

Restore is available only on the loopback desktop surface; it is absent from the paired-mobile
allowlist. The user must first pass the dry-run and then type `RESTORE`. Cumea refuses to proceed
while an agent, routine dispatcher, temporary-agent sweeper, or Local VM lifecycle action is active.

The validated archive is materialized into a sibling staging directory on the same filesystem. The
current data directory is renamed to a timestamped pre-restore backup and staging is renamed into
place. A failed swap or reload restores the previous directory. This makes the visible replacement
atomic; the retained pre-restore directory is intentional recovery data and must be deleted manually
only after the restored workspace has been checked.

Selective agent restore replaces records owned by that agent while preserving unrelated local
agents. Conflicting conversation, attachment, task, run, or routine identifiers fail closed instead
of silently overwriting another agent.

The current archive format and data schema are both version `1`. Cumea rejects newer or otherwise
unsupported versions; it never guesses a migration.

## Corrupt local persistence

Cumea distinguishes a missing first-run file from malformed, oversized, unsupported, unreadable,
symlinked, or schema-invalid persistence. A corrupt store enters a fail-closed degraded state:
Cumea keeps the original file untouched and blocks writes that could replace it with an empty
in-memory fallback. Backup export also refuses to package a fallback snapshot.

The local desktop lists only safe diagnostics (store label, filename, category, size, and detection
time). These diagnostics and recovery actions are not available to paired mobile devices. Prefer
restoring a verified backup. The explicit reset action requires typing the exact filename, copies
the original bytes into the owner-only `recovery` directory, and atomically stages a minimal valid
replacement. Cumea continues blocking writes until the app restarts and strictly reloads that file;
the reset response is never treated as a live in-memory recovery. Inspect and remove preserved
recovery copies manually only after the restored state has been verified.
