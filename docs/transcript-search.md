# Local transcript search index

Cumea keeps transcript search in a separate owner-local SQLite/WAL database. It is intentionally **derived** from the canonical folded conversation history rather than being the source of truth.

## Current persistence boundary

Canonical conversation history lives in `transcripts.sqlite`. `message-search.sqlite` contains only the bounded visible-text projection needed for local search.

Existing `messages-<threadId>.json` files from older installs are immutable migration/recovery anchors; new canonical threads create no JSON transcript and migrated anchors are removed with their bot.

## What is indexed

Only text already folded into user-visible transcript messages is eligible:

- message text;
- visible option-card title, subtitle, and choices;
- visible tool/activity names;
- visible handoff names, prompt, and reply;
- attachment display names.

The index does **not** ingest raw screen pixels, provider-native resume cursors, hidden reasoning/raw provider events, credentials, connector secrets, or attachment filesystem paths. Search results are additionally filtered against the current bot roster so hidden bots do not appear.

Each indexed message is capped to 64 KiB of UTF-8 search text. Queries are capped at 200 characters and results at 50 rows. FTS5 is used when Node's SQLite build provides it; only a missing FTS5 module activates the bounded `LIKE` fallback. Other SQLite initialization/write failures make the derived index unavailable instead of being mistaken for a feature fallback.

## Desktop search and exact navigation

The existing desktop sidebar search is the single search surface for both agent metadata and visible transcript messages. Message search is debounced and local-only. Selecting a transcript hit requests a bounded window around that exact message instead of loading an entire long conversation, highlights the focused message, and exposes **Return to latest** when newer history exists outside the window.

The local APIs are:

```text
GET /api/search/messages?q=<query>&limit=<1..50>
GET /api/bots/<botId>/messages?around=<messageId>&limit=<1..240>
```

Exact navigation defaults to 120 messages and is capped at 240. The window keeps slightly more context before the hit than after it, always retains the hit, and reports whether older or newer history exists outside the window.

The paired remote/mobile surface does not expose global transcript search or exact-message navigation.

## Visible transcript export

Desktop-local export is available in Markdown from the chat header; JSON is also exposed as an API primitive:

```text
GET /api/bots/<botId>/export?format=markdown
GET /api/bots/<botId>/export?format=json
```

Exports are bounded to 20,000 messages and 10 MiB of projected visible data. They contain only folded fields already visible in the transcript. Raw screen bytes, provider request/session identifiers, resume cursors, attachment IDs, connector secrets, and filesystem paths are not exported. Screenshot messages become an explicit omission marker. The JSON form uses schema `cumea.visible-transcript.v1`.

Export and exact navigation return `403` on the authenticated paired-device surface; neither capability widens the mobile privacy boundary.

## Revision-based self-healing

The production canonical backend uses each thread's SQLite revision as the derived-index reconciliation token.

Every successful canonical append or patch advances the thread revision. The corresponding search update stores the same `canonical_revision`. On harness startup:

- a matching revision requires no rebuild;
- a missing or mismatched revision rebuilds only that thread from canonical SQLite.

This closes the crash window where canonical SQLite committed but the process died before the derived search upsert. The older JSON file-fingerprint state remains supported only for legacy/test compatibility; it is no longer the production source of truth.

## Deletion and privacy

Deletion remains fail-closed and participates in the same bot deletion transaction as canonical history:

1. canonical SQLite enters a reversible `pending_delete` state;
2. derived search rows are deleted;
3. bot/workspace metadata is prepared;
4. canonical SQLite commits its DELETE and WAL truncate privacy checkpoint while retaining an exact rollback snapshot;
5. quarantined attachments, event/native logs, and any legacy transcript anchor are purged;
6. only a complete outer purge releases the rollback snapshot and makes deletion final.

If metadata persistence, search deletion, the post-COMMIT canonical checkpoint, or a later file purge fails, Cumea restores the canonical transcript and the derived search projection when rollback remains possible. If a residual search database exists but cannot be opened, bot deletion is rejected rather than pretending indexed text was removed.

The SQLite handle is closed during normal harness shutdown and also when initialization fails partway through. The database path is created/repaired owner-only and lives inside Cumea's owner-only data directory.

### Recovering a broken derived index

Because `message-search.sqlite` is derived, it can be rebuilt without deleting canonical conversation history. Close every Cumea process first, then move these files out of `~/.cumea/` as a recovery backup if they exist:

```text
message-search.sqlite
message-search.sqlite-wal
message-search.sqlite-shm
```

On the next start, Cumea creates a fresh owner-local index and rebuilds current bot threads from `transcripts.sqlite` using canonical revisions. Do **not** remove `transcripts.sqlite` as part of search-index recovery.

## P0.11 status

P0.11 is complete: canonical folded transcripts use incremental SQLite, local search self-heals by canonical revision, desktop search can jump to exact bounded message windows, and visible transcript export remains local and privacy-bounded.
