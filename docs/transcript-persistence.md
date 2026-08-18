# Canonical transcript persistence

P0.11b migrates folded conversation history from whole-thread JSON rewrites to an owner-local SQLite/WAL source of truth. The migration is intentionally split into independently reviewable gates.

## P0.11b1: database foundation

`server/transcript-store.ts` introduces `transcripts.sqlite` without changing production `Store` reads or writes yet.

The database uses:

- owner-only storage inside Cumea's data directory;
- SQLite WAL;
- `synchronous=FULL` because this database will become canonical;
- foreign keys;
- `secure_delete=ON`;
- a versioned schema with one ordered row per folded transcript message;
- a per-thread revision counter;
- explicit `active` and `pending_delete` states.

### Verified legacy import

A legacy `messages-<threadId>.json` file is never partially imported. Cumea first reads and parses the complete source, validates the root and required message identity/order fields, rejects duplicate IDs, and calculates the SHA-256 of the original bytes. Only then does one `BEGIN IMMEDIATE` transaction create the thread and all message rows.

The transaction verifies its inserted row count before `COMMIT`. A crash or exception before commit leaves no canonical thread marker, so a later attempt starts from the untouched JSON source rather than guessing whether a partial migration is valid.

The source JSON remains byte-identical in b1. It is a migration/recovery source, not yet retired.

### Incremental writes

The database contract already supports append and message replacement without rewriting the full thread. Each successful mutation advances the thread revision. P0.11b2 will wire those operations into the production `Store` after the database contract is green on all supported CI operating systems.

### Deletion protocol

Phase-one deletion changes the thread to `pending_delete` but deliberately keeps every message row present. Reads, appends, and patches fail closed while that state is active.

The phase is reversible. If the surrounding bot/workspace/filesystem transaction fails, rollback returns the thread to `active`. If Cumea crashes while a delete is pending, startup reconciliation compares pending thread IDs with the authoritative bot roster:

- a still-owned thread is restored to `active`;
- an orphaned pending thread is finalized and scrubbed.

The irreversible finalize step is reserved for the outer transaction's commit path. P0.11b3 will add the end-to-end HTTP deletion and crash-window evidence before canonical JSON writes are retired.

### Backups

The canonical database exposes a `VACUUM INTO` backup primitive. Tests require the produced database to open independently and contain the same transcript. This is a local recovery primitive, not the encrypted portable backup format tracked separately in P2.09.

## Remaining gates

- **P0.11b2:** wire production reads, appends and patches to SQLite; reconcile the derived search index against canonical thread revisions; stop whole-thread JSON writes after a verified import.
- **P0.11b3:** integrate pending-delete recovery with the real bot deletion transaction, prove crash/restart behavior, document recovery and backup, and retire active canonical JSON writes safely.
- **P0.11c:** add desktop global transcript search/navigation, exact-message jumps, and export without widening the remote/mobile surface.
