# Engine and native-session freshness

Cumea can route one conversation through different provider instances over time. A provider-native resume cursor is useful only while the native session still represents the latest canonical conversation.

A cursor is therefore **not** trusted merely because one exists in bot metadata.

## The stale-session problem

Consider one thread routed as:

```text
Claude A → Gemini B → Claude A
```

The old Claude session does not contain the intervening Gemini turn. Resuming it directly would silently fork the provider's native context away from Cumea's canonical transcript.

The same problem exists after:

- provider-fleet/config reload;
- a model change on an adapter that cannot switch models inside one native session;
- a crash after dispatch started but before the replacement native session announced `session.started`;
- missing or ambiguous legacy cursor state.

## Private freshness state

Cumea keeps a small owner-local `session-freshness.json` beside the harness data. It is deliberately separate from `BotRecord` so this implementation detail is not projected into desktop or paired mobile bot DTOs.

Each thread is one of:

- `dispatched` — a matching `session.started` confirmed the selected instance/model;
- `pending` — dispatch began, but no matching native session has been confirmed yet;
- `invalidated` — the provider fleet was reloaded and old native sessions must not be trusted.

The file contains no transcript text, provider credentials, prompts, or native protocol payloads.

### Dispatch ordering

For every turn:

```text
canonical user message persisted
→ decide resume vs rebuild from canonical history
→ persist freshness = pending
→ adapter.sendTurn(...)
→ provider emits session.started
→ persist provider resume cursor
→ confirm freshness = dispatched
```

This ordering closes the crash window between handing work to a provider and receiving its new native session id. If the process dies while freshness remains `pending`, the next turn rebuilds from canonical history even if an older cursor still exists.

Provider reload invalidation is persisted **before** the old fleet is detached/disposed. If that private owner-local write fails, reload fails closed and leaves the current provider fleet intact.

## Resume decision

A native session is resumed only when:

1. the thread has prior user history;
2. freshness is `dispatched`;
3. the selected provider instance is still the last dispatched instance;
4. the selected native cursor exists;
5. if the adapter reports `sessionModelSwitch: unsupported`, the selected model is unchanged.

Otherwise Cumea starts a fresh native session and rebuilds bounded context from canonical folded transcript history.

One migration exception exists for pre-freshness installations: exactly one non-empty cursor belonging to the selected instance can be treated as an unambiguous legacy session. Multiple/foreign legacy cursors rebuild instead of guessing.

## Bounded canonical rebuild

Rebuild history is limited by all of:

- newest 40 settled visible text messages;
- 16 KiB UTF-8 per message;
- about 96 KiB total quoted context.

The current user message is excluded from that history and sent exactly once.

Claude, ACP-based runtimes, and Codex share the same native cursor guard. When `rebuildContext` is true they refuse every supplied resume cursor, create a new native session/thread, and quote canonical history into the **user turn**.

Prior user/model content is not copied into the system prompt. The quoted block explicitly states that it is lower-priority conversation history and can contain earlier user instructions or model output.

The key-billed Grok API driver is transcript-replay rather than native-session continuation and continues to use canonical `turn.transcript` directly.

## Failure behavior

- missing/corrupt freshness metadata is treated as unknown and rebuilds ambiguous state;
- a dispatch that fails after `pending` was persisted remains pending, causing a safe rebuild next time;
- a `session.started` from a different instance cannot confirm another instance's pending record;
- failure to persist `session.started` confirmation leaves the thread pending, which is slower but safe;
- bot deletion removes the private freshness record after the user-visible deletion transaction succeeds.

## Scope

This solves context correctness across engine/model/session boundaries. It does not implement queued steering while a bot is busy; that is tracked separately as P0.12b.
