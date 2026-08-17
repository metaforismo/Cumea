# Desktop bootstrap consistency

Cumea's desktop renderer starts from one bounded local snapshot instead of independently loading bots, engines, configuration, and work history.

## Startup protocol

1. The renderer opens `/api/events`.
2. The local SSE stream sends `hello` with the current monotonic `eventCursor`.
3. The renderer requests `/api/bootstrap`, optionally naming the currently selected bot.
4. While the snapshot is in flight, cursor-bearing SSE frames are buffered.
5. The server awaits provider discovery, then synchronously captures the remaining startup projection and the current cursor.
6. The renderer hydrates bots, selected transcript, engines, configuration, and bounded workspace state in one reducer action.
7. Buffered frames at or below the snapshot cursor are discarded; strictly newer frames are folded in arrival order.

The same protocol runs again after every SSE reconnect. A reconnect therefore does not issue the old four-request reload cascade.

## Bounds

The startup projection intentionally does not attempt to serialize unlimited history:

- bot index: at most 200 entries, while an explicitly selected bot is retained even beyond the cap;
- selected transcript: at most 80 messages, 2 MiB total, 512 KiB per startup item;
- oversized screen pixels may be omitted because they are reproducible projections;
- oversized canonical text is omitted, never silently truncated into different text;
- workspace sections, attachments, tasks, runs, and routines have independent count and byte budgets;
- the renderer buffers at most 2,048 SSE frames during a snapshot cut.

Every workspace category reports omitted-record counts. If the startup workspace was truncated, opening Work performs a normal full `/api/work` reload outside the startup critical path.

## Event cursor

The local harness increments one safe-integer cursor per broadcast, even when no renderer is connected. Local SSE envelopes include that cursor. Remote/mobile clients keep their existing narrowed stream and do not depend on the desktop cursor contract.

The snapshot cut is made only after provider discovery has settled. No asynchronous operation occurs between reading durable in-memory state and capturing `eventCursor`. Any later mutation therefore receives a greater cursor and can be distinguished from state already represented in the snapshot.

If the renderer receives a malformed cursor or its bounded in-flight buffer overflows, it requests a fresh snapshot rather than guessing which state was lost.

## Privacy boundary

The bootstrap is local-only. It does not expose provider-native resume cursors, credential values, stored attachment paths, or a new remote endpoint. Configuration remains configured/not-configured status only. Computer status is capability/configuration state, not a secret or a control token.

## What this does not solve

P0.04 reduces startup requests and gives reconnects a consistency cut. It does not yet virtualize long desktop transcripts, isolate every renderer subscription, replace JSON transcript persistence, or prove a fixed-machine speedup. Those are separate performance/evidence items in `TODO.md`.
