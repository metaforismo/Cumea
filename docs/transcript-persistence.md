# Canonical transcript persistence

P0.11b moves folded conversation history from whole-thread JSON rewrites to an owner-local SQLite/WAL source of truth. The migration was split into three gates so performance work never weakened deletion or recovery semantics.

## Current production boundary

The real harness now opens `Store({ messageSearch: true, transcripts: true })`.

Canonical folded conversation history lives in `transcripts.sqlite` and uses:

- owner-only storage inside Cumea's data directory;
- SQLite WAL;
- `synchronous=FULL` because this database is authoritative;
- foreign keys;
- `secure_delete=ON`;
- a versioned schema with one ordered row per folded transcript message;
- a per-thread revision counter;
- explicit `active` and `pending_delete` states.

New bots create no `messages-<threadId>.json` transcript. Existing JSON files from older Cumea versions are verified migration/recovery anchors only: they are imported once, never rewritten by the canonical backend, and removed when their migrated bot is successfully deleted.

## Verified legacy import

A legacy `messages-<threadId>.json` file is never partially imported. Cumea first reads and parses the complete source, validates the root and required message identity/order fields, rejects duplicate IDs, and calculates the SHA-256 of the original bytes. Only then does one `BEGIN IMMEDIATE` transaction create the thread and all message rows.

The transaction verifies its inserted row count before `COMMIT`. A crash or exception before commit leaves no canonical thread marker, so a later attempt starts from the untouched JSON source rather than guessing whether a partial migration is valid.

A malformed legacy source blocks canonical startup for that owned thread. Cumea does not silently choose an incomplete SQLite view over the recovery source.

## Incremental reads and writes

For the production Store:

1. transcript reads come from canonical SQLite;
2. appends insert one message row and advance the thread revision;
3. patches update one existing row and advance the revision;
4. in-memory folded state is changed only after the canonical SQLite mutation succeeds;
5. the legacy JSON source, when one exists, is not rewritten.

This removes the old O(thread size) write amplification from every streamed transcript mutation.

## Derived search reconciliation

`message-search.sqlite` is still derived and is not part of the canonical durability contract.

P0.11a originally reconciled it against JSON file fingerprints. That path remains only for legacy/test compatibility. The production canonical backend stores a per-thread `canonical_revision` in the search database. Every successful append or patch updates the visible search row and revision; on restart Cumea compares search and canonical revisions:

- equal revisions avoid a rebuild;
- a mismatch rebuilds only that thread from canonical SQLite.

This closes the crash window where canonical SQLite committed but the process exited before the derived search upsert.

## Rollback-capable deletion

Deletion is a privacy boundary, not cache invalidation. The canonical transaction therefore remains reversible even after its SQLite `DELETE` has committed.

For each bot deletion:

1. the outer HTTP transaction stops in-flight work and quarantines bot-owned external files, including attachments, event/native logs, and any legacy transcript anchor;
2. the canonical thread enters `pending_delete`, freezing reads/appends/patches while preserving its rows;
3. derived search rows are removed and bot/workspace metadata is prepared;
4. canonical SQLite deletes the thread, commits, and performs the WAL truncate privacy checkpoint, while retaining an exact private snapshot of the thread state and ordered message rows;
5. the outer transaction purges quarantined files;
6. only after every purge succeeds does `finalize()` release the canonical rollback snapshot and expose the deletion as complete.

If the SQLite checkpoint fails after the DELETE already committed, or a later file purge fails, rollback reconstructs the exact canonical thread including its previous revision, SHA-256 import provenance, import timestamp, ordered messages, bot metadata, search rows, and quarantined files where restoration is still possible.

Tests cover metadata failure, search failure boundaries, legacy-anchor purge failure after canonical commit, and an injected post-COMMIT checkpoint failure.

## Process-crash recovery

`pending_delete` is durable. On harness startup, Cumea reconciles pending thread IDs against the authoritative bot roster before normal transcript use:

- if the bot still exists, its pending thread returns to `active`;
- if the bot metadata commit won and no bot owns the thread, the orphaned pending transcript is finalized and privacy-checkpointed.

A real-harness restart test leaves a canonical thread deliberately pending, restarts the same profile, and requires the bot, transcript, and search result to recover.

## Backup and recovery

`TranscriptStore.backupTo()` uses SQLite `VACUUM INTO`. Tests require the produced backup database to open independently and contain the same transcript history.

For a local recovery copy, stop every Cumea process first and back up at least:

```text
transcripts.sqlite
bots.json
workspace.json
```

plus bot-owned attachment/event/native data that you intend to preserve. Do not copy a live WAL database by grabbing only `transcripts.sqlite` while Cumea is running; use the backup primitive or stop the app first.

The `VACUUM INTO` database is a local durability primitive, not the encrypted portable full-workspace backup/import format tracked in P2.09.

## What remains in P0.11

P0.11b is complete: canonical transcript persistence is incremental SQLite in production, with verified migration, revision-aware search reconciliation, rollback-capable deletion, crash recovery, and local backup evidence.

P0.11c adds the desktop user-facing layer: global transcript search/navigation, exact-message jumps, and bounded visible-transcript export without widening the remote/mobile surface.
