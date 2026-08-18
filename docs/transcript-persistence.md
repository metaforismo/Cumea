# Canonical transcript persistence

P0.11b migrates folded conversation history from whole-thread JSON rewrites to an owner-local SQLite/WAL source of truth. The migration is intentionally split into independently reviewable gates.

## P0.11b1: database foundation

`server/transcript-store.ts` introduces `transcripts.sqlite` without changing the production harness yet.

The database uses:

- owner-only storage inside Cumea's data directory;
- SQLite WAL;
- `synchronous=FULL` because this database becomes canonical;
- foreign keys;
- `secure_delete=ON`;
- a versioned schema with one ordered row per folded transcript message;
- a per-thread revision counter;
- explicit `active` and `pending_delete` states.

### Verified legacy import

A legacy `messages-<threadId>.json` file is never partially imported. Cumea first reads and parses the complete source, validates the root and required message identity/order fields, rejects duplicate IDs, and calculates the SHA-256 of the original bytes. Only then does one `BEGIN IMMEDIATE` transaction create the thread and all message rows.

The transaction verifies its inserted row count before `COMMIT`. A crash or exception before commit leaves no canonical thread marker, so a later attempt starts from the untouched JSON source rather than guessing whether a partial migration is valid.

The source JSON remains byte-identical as a migration/recovery anchor until the final cutover gate retires the active legacy path.

## P0.11b2: guarded Store cutover

`Store` now accepts an explicit `transcripts: true` option. That backend is real and covered by the cross-platform suite, but the production harness deliberately does not enable it until P0.11b3 proves canonical deletion through the complete HTTP/workspace/filesystem transaction.

When the option is enabled:

1. every currently owned bot thread is established in `transcripts.sqlite` using the verified import contract;
2. transcript reads come from canonical SQLite;
3. appends insert one new message row and advance the thread revision;
4. patches update one existing row and advance the revision;
5. the in-memory folded transcript is mutated only after the canonical SQLite operation succeeds;
6. existing legacy JSON is no longer rewritten and new cutover threads create no whole-thread JSON file.

A malformed legacy source therefore blocks the cutover instead of silently falling back to an incomplete canonical view.

### Derived search reconciliation

P0.11a originally reconciled `message-search.sqlite` against a canonical JSON file fingerprint. That remains supported for the legacy backend.

The cutover backend instead stores a per-thread `canonical_revision` in the derived search database. Every successful canonical append/patch updates the search row and revision together. On restart, Cumea compares the canonical transcript revision with the derived revision:

- equal revisions avoid a rebuild;
- a mismatch rebuilds only that thread from canonical SQLite.

This closes the crash window where the canonical SQLite transaction commits but the process exits before the derived search upsert. Search remains derived and can fail independently without weakening the canonical transcript.

### Deliberate deletion gate

`Store({ transcripts: true })` currently rejects bot deletion with a fail-closed 409-style error. This is intentional: enabling incremental writes before connecting canonical pending-delete to the real bot/workspace/filesystem transaction could leave transcript residue after a user-visible delete.

P0.11b3 replaces that guard with the reversible canonical deletion protocol, adds crash/restart and privacy cleanup evidence, and only then enables `transcripts: true` in the real harness.

## Deletion protocol foundation

Phase-one deletion changes the thread to `pending_delete` but deliberately keeps every message row present. Reads, appends, and patches fail closed while that state is active.

The phase is reversible. If the surrounding transaction fails, rollback returns the thread to `active`. If Cumea crashes while a delete is pending, startup reconciliation compares pending thread IDs with the authoritative bot roster:

- a still-owned thread is restored to `active`;
- an orphaned pending thread is finalized and scrubbed.

The irreversible finalize step is reserved for the outer transaction's commit path.

## Backups

The canonical database exposes a `VACUUM INTO` backup primitive. Tests require the produced database to open independently and contain the same transcript. This is a local recovery primitive, not the encrypted portable backup format tracked separately in P2.09.

## Remaining gates

- **P0.11b3:** integrate pending-delete with the real HTTP bot deletion transaction, prove crash/restart and privacy cleanup windows, enable the canonical backend in production, and retire active JSON writes safely.
- **P0.11c:** add desktop global transcript search/navigation, exact-message jumps, and export without widening the remote/mobile surface.
