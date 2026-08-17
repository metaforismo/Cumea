# Desktop credential storage

Cumea can use several optional third-party credentials, but none is required to open the app or use
an already-authenticated local agent CLI. The packaged Electron desktop and the source/browser host
have deliberately different storage boundaries.

## Packaged Electron desktop

The packaged desktop stores optional xAI, Composio Connect, Composio project, and Box credentials in
an encrypted vault under Electron's `userData` directory. Vault contents are encrypted through
Electron [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) using its
asynchronous API.

The operating-system protection model differs by platform:

- macOS uses Keychain-backed protection;
- Windows uses DPAPI-backed protection;
- Linux depends on the desktop secret service selected by Electron.

Cumea rejects Electron's Linux `basic_text` backend instead of silently claiming that hard-coded
plaintext encryption is secure. If a secure backend is unavailable, the packaged app enters
`blocked` mode and refuses new credential writes.

The vault document is versioned, validated against an exact credential allowlist, bounded to 8 KiB
per value, written atomically, and kept owner-only where the platform supports POSIX modes. The file
is removed when the final stored credential is cleared.

## Migration from `~/.cumea/config.json`

On the first packaged launch after this feature is installed, Electron checks the existing local
configuration for legacy plaintext credentials.

Migration order is fail-safe:

1. read and validate the existing encrypted vault;
2. merge legacy values, with an existing vault value winning over a stale plaintext duplicate;
3. encrypt and atomically replace the vault;
4. only after that succeeds, atomically rewrite `config.json` without credential fields.

Profile data, endpoint overrides, and other non-secret configuration are preserved. If encryption,
decryption, validation, or the OS credential service fails, the legacy file is left untouched as a
recovery source. The packaged harness still starts in managed mode with an empty credential set, so
that preserved plaintext is not consumed while storage is blocked.

After the OS credential service is repaired, restart Cumea. A successful migration removes the
legacy plaintext automatically. Do not delete `config.json` manually before that point unless the
credentials have been recovered elsewhere.

## Write-only renderer contract

The renderer never receives credential values. It can read only:

- the storage mode and non-secret backend status;
- configured/not-configured booleans for each credential;
- migration or recovery-state booleans;
- a bounded non-secret failure reason.

A packaged credential replacement or clear operation crosses a narrow IPC method containing only an
allowlisted section identifier and a string-or-null value. The preload reconstructs that payload,
and Electron validates it again before persistence.

The normal loopback configuration API remains write-only and returns booleans, but packaged UI code
does not use it for credential persistence.

## Harness bootstrap and restart

The harness has no runtime endpoint for fetching credentials from Electron. At harness startup,
Electron decrypts the vault and passes the current allowlisted values through dedicated bootstrap
environment fields to the new child process. The harness validates and copies them into memory, then
deletes those bootstrap fields from `process.env` before provider instances or provider child
processes are created.

When a packaged credential changes, Electron:

1. writes the candidate encrypted vault;
2. stops the local harness;
3. starts a fresh harness on the existing loopback port with the new bootstrap;
4. verifies its identity and reads the new configured-status response;
5. lets the renderer's existing SSE connection reconnect and resynchronize.

This can interrupt in-flight provider turns, just as the previous provider-fleet reload did. The UI
must not describe a credential update as background-safe.

If the new harness cannot start, Electron restores the previous vault and in-memory credential set,
then makes a best-effort restart with the previous bootstrap. The update is reported as failed.

## Source and browser mode

When the harness and browser UI are run directly from source, there is no Electron main process to
own an OS credential vault. That mode retains the explicit `~/.cumea/config.json` fallback with
owner-only permissions where supported.

This is a development/self-hosting boundary, not the packaged desktop's storage behavior. Users who
run the source host should protect their operating-system account, home directory, backups, shell
environment, and configuration file accordingly.

Environment-variable fallbacks remain available for source/server deployments. In packaged managed
mode, known ambient credential variables are removed from the harness bootstrap so they cannot
silently override or repopulate the OS-backed vault.

## Performance fixture

The deterministic packaged performance fixture uses `performance-fixture` mode. It starts the
harness with managed credentials enabled but with an empty credential set. It neither reads nor
writes the OS vault and removes known external credential variables from the child environment.
Performance evidence is therefore not provider-authentication evidence.

## Threat boundary

This design protects against accidental plaintext-at-rest persistence, renderer/API secret reads,
stale plaintext reuse in a blocked packaged app, and unintentional inheritance of bootstrap fields
by provider processes.

It does not protect credentials from:

- malicious code already running as the same operating-system user;
- a compromised Electron main process or harness process;
- memory inspection with equivalent local privileges;
- a provider process that legitimately needs and receives its configured credential;
- the third-party service receiving the credential during an explicitly requested operation;
- insecure backups or disk images made before migration.

On Windows, DPAPI protects against other users but not necessarily other applications running as the
same user. On macOS, stable code signing is required for consistent Keychain identity across app
updates. The current unsigned package-layout smoke verifies files only; it is not proof of Keychain,
DPAPI, Linux secret-service, signing, notarization, or physical-machine acceptance.
