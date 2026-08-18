# Local transcript search index

P0.11a adds an owner-local search index without changing the canonical transcript format yet.

## Current persistence boundary

Canonical conversation history is still stored in `messages-<threadId>.json` and keeps Cumea's existing atomic-write and file-quarantine rollback behavior. `message-search.sqlite` is a **derived** SQLite/WAL projection used only for local search.

This ordering is deliberate. Moving the source of truth to SQLite before migration, deletion, and rollback semantics are proved would trade one performance problem for a weaker recovery contract. P0.11b is the separate canonical-store migration gate.

## What is indexed

Only text already folded into user-visible transcript messages is eligible:

- message text;
- visible option-card title, subtitle, and choices;
- visible tool/activity names;
- visible handoff names, prompt, and reply;
- attachment display names.

The index does **not** ingest raw screen pixels, provider-native resume cursors, hidden reasoning/raw provider events, credentials, connector secrets, or attachment filesystem paths. Search results are additionally filtered against the current bot roster so hidden bots do not appear.

Each indexed message is capped to 64 KiB of UTF-8 search text. Queries are capped at 200 characters and results at 50 rows. FTS5 is used when Node's SQLite build provides it; otherwise Cumea falls back to a bounded local `LIKE` query.

## API

Desktop-local only:

```text
GET /api/search/messages?q=<query>&limit=<1..50>
```

The remote/mobile allowlist does not expose this endpoint. A response reports whether local search is available and whether it is running in `fts5`, `like`, or `unavailable` mode.

## Migration and self-healing

On harness startup, the derived index checks every current bot thread. Existing indexed threads are left alone. Missing rows are rebuilt from canonical JSON, so a previous transient rollback/index failure cannot create a permanent search hole merely because an older global seed marker exists.

Corrupt/unreadable canonical transcripts follow the existing Store recovery behavior: one bad legacy file does not prevent healthy threads from indexing or Cumea from starting.

## Deletion and privacy

Deletion remains fail-closed:

1. Cumea snapshots the canonical transcript before moving its JSON file into the deletion quarantine.
2. The derived SQLite thread is deleted.
3. SQLite uses `secure_delete=ON`; a privacy-sensitive delete also requires a WAL truncate checkpoint.
4. Only then may bot metadata commit and quarantined canonical bytes be purged.
5. If metadata commit or the SQLite delete/checkpoint fails, Cumea restores the derived rows from the pre-quarantine snapshot and restores the canonical JSON file.

If a residual search database exists but Cumea cannot open it, bot deletion is rejected rather than pretending indexed text was removed. This is stricter than treating a derived index as disposable because deletion is a privacy boundary, not only a cache invalidation operation.

The SQLite handle is closed during normal harness shutdown. The database path is created/repaired owner-only and lives inside Cumea's owner-only data directory.

## What remains in P0.11

P0.11a establishes the search/deletion contract but intentionally leaves whole-thread canonical JSON rewrites in place.

P0.11b will migrate canonical transcript persistence to incremental SQLite with a versioned, rollback-aware import path and crash/recovery evidence. P0.11c will add desktop global navigation, transcript-result jumping, and export on top of the local index without widening the remote surface.
