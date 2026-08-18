# Busy-user steering

Cumea keeps one provider turn active per conversation, but an attended user does not have to wait for that turn to finish before giving the agent more direction.

P0.12b adds a bounded, durable steering queue for **explicit user messages only**. Routines, task retries and peer-agent fan-out do not bypass the existing one-turn-per-thread guard.

## Visible lifecycle

A user message sent while the agent is already working is appended immediately to the canonical transcript and receives a small delivery state:

- `queued` — waiting behind the current provider turn;
- `dispatching` — this steering batch has been durably claimed and is being handed to the provider;
- `failed` — Cumea knows it must not silently retry the batch.

A normal delivered message has no delivery field.

Desktop and paired mobile show the queued/failure state without exposing provider-native identifiers or any new private payload.

## Bounds and coalescing

Per conversation, the waiting queue is limited to:

- 8 messages;
- 64 KiB of UTF-8 user text;
- 20 distinct attachment IDs.

When the current turn settles, the waiting rows are ordered by canonical timestamp/id and coalesced into **one** attended follow-up turn. Their original transcript rows remain visible and auditable.

The coalesced rows are excluded from the provider history for that same follow-up, so each steering instruction appears exactly once in the provider request rather than once as history and again as the current prompt.

## At-most-once dispatch boundary

The dangerous failure window is between deciding to drain a queue and the external provider accepting work. Cumea therefore does not clear `queued` after the provider call.

Instead the full selected batch changes atomically in canonical SQLite:

```text
queued rows
→ one SQLite transaction: dispatching
→ provider turn starts
→ provider turn settles
→ one SQLite transaction: ordinary delivered rows
```

The batch replacement increments the canonical thread revision once. If any row is missing or SQLite cannot commit, the whole transition rolls back and no provider call is attempted.

This favors avoiding duplicate user instructions or duplicate external effects over automatic retry after an ambiguous crash.

## Crash and reload behavior

There are two different restart cases:

1. **Still `queued`**: the old process never claimed those rows. A fresh harness may safely coalesce and drain them after confirming there is no live provider turn owned by the new process.
2. **`dispatching`**: the old process crossed the durable pre-dispatch boundary. Cumea cannot know whether the provider partially acted before the crash, so it marks those rows `failed`/interrupted and does **not** replay them automatically.

Provider-fleet reload follows the same rule for an actively dispatching steering batch: the batch becomes failed rather than being guessed/retried.

A failed or dispatching steering row is also excluded from future canonical context rebuilds. It can remain visible in history, but it cannot accidentally become an instruction in an unrelated later turn.

## Stop semantics

While an agent is working, desktop and mobile expose Stop and Send as separate controls. Stop means **stop the current provider turn**; already queued steering remains queued and becomes the next attended follow-up when that turn settles. The UI labels the action accordingly instead of treating Stop as an implicit queue deletion.

## Persistence and privacy

Queue state lives on the existing canonical transcript row in owner-local `transcripts.sqlite`; there is no second message store or hosted queue. The derived search index remains rebuildable from canonical revisions.

Remote/mobile projection allowlists only the visible delivery label. Provider cursors, raw protocol data, filesystem paths and credentials remain outside the companion protocol.

## Scope

This tranche does not add automatic retry loops, room steering, routine queueing, child-agent queueing, or stall detection. Activity liveness/repeated-effect protection remains P0.12a.
