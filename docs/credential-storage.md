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

The vault document is versioned, validated against an exact credential allowlist, bounded to 8,192
characters per value, written atomically, and kept owner-only where the platform supports POSIX
modes. The file is removed when the final stored credential is cleared.

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

## Write-only renderer and API contract

The renderer never receives credential values. It can read only:

- the storage mode and non-secret backend status;
- configured/not-configured booleans for each credential;
- migration or recovery-state booleans;
- a bounded non-secret failure reason.

A packaged credential replacement or clear operation crosses a narrow IPC method containing only an
allowlisted section identifier and a string-or-null value. The preload reconstructs that payload,
and Electron validates it again before persistence.

In packaged managed mode, credential-shaped writes to the ordinary loopback `/api/config` endpoint
are rejected, including empty/null values intended as clears. Electron IPC is the only valid
credential transport. The loopback endpoint remains a write-only credential path only for explicit
source/browser hosting, where there is no Electron main process to own an OS vault.

## Harness bootstrap and provider scope

The harness has no runtime endpoint for fetching credentials from Electron. At harness startup,
Electron decrypts the vault and passes the current allowlisted values through dedicated bootstrap
environment fields to the new child process. Explicit empty values overwrite any ambient
`CUMEA_DESKTOP_*` fields, so the controller's current vault state is authoritative.

The harness validates and copies the bootstrap into memory, then deletes those dedicated fields from
`process.env` before provider instances or provider child processes are created. In packaged managed
mode it also ignores credential aliases embedded in plaintext advanced instance environments.
Non-secret instance environment values remain supported.

Credentials are scoped by use:

- the xAI API key is mounted as process environment only into the key-billed `grok` API driver;
- the Box token is mounted as process environment only into the `boxAgent` driver;
- Composio credentials remain in the harness until an apps-enabled turn is routed to a driver that
  explicitly advertises Composio MCP support; only that integration receives the Connect key;
- providers and turns that do not own or explicitly mount one of those capabilities do not inherit
  the corresponding credential through a generic environment merge.

A provider process or integration that legitimately owns a credential can still read that
credential; this design prevents unrelated inheritance, not access by the intended consumer.

## Credential update and harness restart

A packaged credential update uses the previous encrypted vault as a transaction anchor:

1. keep the previous vault untouched;
2. place the candidate only in Electron's in-memory bootstrap state;
3. restart the harness on the existing loopback port with that candidate;
4. verify the new child by PID and health response;
5. read `/api/config` and require the exact credential's configured flag to match the candidate;
6. only after confirmation, atomically commit the candidate to the encrypted vault;
7. let the renderer's existing SSE connection reconnect and resynchronize.

A successful process restart without the expected configured flag is treated as a failed update.
This catches malformed or lost bootstraps instead of reporting a credential as saved merely because
a child process answered HTTP.

This restart can interrupt in-flight provider turns, just as the previous provider-fleet reload did.
The UI must not describe a credential update as background-safe.

If candidate startup or confirmation fails, Electron restores the previous in-memory set and starts
a second harness with the previous bootstrap. The encrypted vault was never replaced, so it remains
the durable source of truth. The update is reported as failed even when automatic recovery succeeds.

If the candidate harness confirms but encryption or atomic persistence fails, Electron again restores
the previous bootstrap and harness. Because vault replacement is the final commit point, the prior
vault remains untouched on that failure path. If the old harness cannot recover and confirm the
previous state, the error explicitly requires a Cumea restart instead of claiming that service was
restored.

A process kill between candidate validation and vault commit also leaves the previous encrypted
vault authoritative. The candidate child exits with the Electron app and is not silently persisted
on the next launch.

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
writes the OS vault, overrides dedicated bootstrap fields with empty values, and removes known
external credential variables from the child environment. Performance evidence is therefore not
provider-authentication evidence.

## Threat boundary

This design protects against accidental plaintext-at-rest persistence, renderer/API secret reads,
stale plaintext reuse in a blocked packaged app, direct managed-API bypasses, ambient/bootstrap
overrides, and unintentional inheritance by unrelated provider processes or turns.

It does not protect credentials from:

- malicious code already running as the same operating-system user;
- a compromised Electron main process or harness process;
- memory inspection with equivalent local privileges;
- a provider process or MCP integration that legitimately needs and receives its configured
  credential;
- the third-party service receiving the credential during an explicitly requested operation;
- insecure backups or disk images made before migration.

On Windows, DPAPI protects against other users but not necessarily other applications running as the
same user. On macOS, stable code signing is required for consistent Keychain identity across app
updates. The current unsigned package-layout smoke verifies files only; it is not proof of Keychain,
DPAPI, Linux secret-service, signing, notarization, migration on a real prior profile, or
physical-machine acceptance.
