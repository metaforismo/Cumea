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

Each indexed message is capped to 64 KiB of UTF-8 search text. Queries are capped at 200 characters and results at 50 rows. FTS5 is used when Node's SQLite build provides it; only a missing FTS5 module activates the bounded `LIKE` fallback. Other SQLite initialization/write failures make the derived index unavailable instead of being mistaken for a feature fallback.

## API

Desktop-local only:

```text
GET /api/search/messages?q=<query>&limit=<1..50>
```

The remote/mobile allowlist does not expose this endpoint. A response reports whether local search is available and whether it is running in `fts5`, `like`, or `unavailable` mode.

## Migration and self-healing

On harness startup, the derived index compares each current thread's stored canonical-file fingerprint with a cheap `stat` fingerprint of the live JSON source (`size`, inode, nanosecond mtime, and nanosecond ctime). Matching threads require no JSON parse. A missing or mismatched fingerprint rebuilds only that thread from canonical JSON.

This closes the crash window where the atomic canonical JSON write succeeded but the following derived SQLite upsert did not. Corrupt/unreadable canonical transcripts remain isolated to their own thread, while SQLite failures during reconciliation propagate and disable the derived index rather than silently creating a permanent search hole.

## Deletion and privacy

Deletion remains fail-closed:

1. Cumea snapshots the canonical transcript while its JSON file is still live, including on the real HTTP deletion path after a cache-cold restart.
2. Canonical and bot-owned files are moved into same-volume deletion quarantine rather than immediately destroyed.
3. The derived SQLite thread is deleted before the bot metadata commit.
4. SQLite uses `secure_delete=ON`; a privacy-sensitive delete also requires a WAL truncate checkpoint.
5. Only after metadata stores commit may quarantined bytes be purged and the deletion become visible.
6. If metadata commit or the SQLite delete/checkpoint fails, Cumea restores the derived rows from the pre-quarantine snapshot and restores the quarantined canonical bytes.

If a residual search database exists but Cumea cannot open it, bot deletion is rejected rather than pretending indexed text was removed. This is stricter than treating a derived index as disposable because deletion is a privacy boundary, not only a cache invalidation operation.

The SQLite handle is closed during normal harness shutdown and also when initialization fails partway through. The database path is created/repaired owner-only and lives inside Cumea's owner-only data directory.

### Recovering a broken derived index

Because `message-search.sqlite` is not canonical in P0.11a, it can be rebuilt without deleting conversation history. Close every Cumea process first, then move these files out of `~/.cumea/` as a recovery backup if they exist:

```text
message-search.sqlite
message-search.sqlite-wal
message-search.sqlite-shm
```

On the next start, Cumea creates a fresh owner-local index and rebuilds current bot threads from the canonical `messages-<threadId>.json` files. Do not remove the canonical JSON files as part of this recovery.

## What remains in P0.11

P0.11a establishes the search/deletion contract but intentionally leaves whole-thread canonical JSON rewrites in place.

P0.11b will migrate canonical transcript persistence to incremental SQLite with a versioned, rollback-aware import path and crash/recovery evidence. P0.11c will add desktop global navigation, transcript-result jumping, and export on top of the local index without widening the remote surface.
