# Engine and native-session freshness

Cumea can route one conversation through different provider instances over time. A provider-native resume cursor is useful only while the native session still represents the latest **successfully completed** canonical conversation.

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
- a crash or failed turn after dispatch started but before that turn completed successfully;
- missing or ambiguous legacy cursor state.

## Private freshness state

Cumea keeps a small owner-local `session-freshness.json` beside the harness data. It is deliberately separate from `BotRecord` so this implementation detail is not projected into desktop or paired mobile bot DTOs.

Each thread is one of:

- `dispatched` — the matching provider instance completed its dispatched turn successfully;
- `pending` — a turn was prepared/dispatched, but successful completion has not been durably confirmed;
- `invalidated` — the provider fleet was reloaded and old native sessions must not be trusted.

The file contains no transcript text, provider credentials, prompts, or native protocol payloads.

### Dispatch ordering

Cumea captures the previously trusted selection before changing freshness state. For every turn the ordering is:

```text
capture previous freshness / choose the selected instance+model
→ persist freshness = pending
→ persist the new canonical user message
→ build bounded prior context excluding that new message
→ decide resume vs rebuild using the captured previous freshness
→ adapter.sendTurn(...)
→ session.started may persist the provider's new resume cursor
→ turn.completed(ok=true)
→ confirm freshness = dispatched
```

`session.started` is deliberately **not** the confirmation point. Some native runtimes announce a session before the current user turn has been fully incorporated. A cursor can therefore be stored on `session.started`, but it remains untrusted while freshness is `pending`.

If the process dies, the provider exits, or the turn fails anywhere after `pending` was persisted and before successful completion, the next turn rebuilds from canonical history even if an older or newly announced cursor remains in bot metadata.

Writing `pending` happens before the new user message is appended. If that small owner-local freshness write fails, the turn fails closed before the new message is committed rather than entering a state whose native-session trust cannot be represented durably.

Provider reload invalidation is persisted **before** the old fleet is detached/disposed. If that private owner-local write fails, reload fails closed and leaves the current provider fleet intact.

## Resume decision

A native session is resumed only when:

1. the thread has prior user history;
2. freshness is `dispatched`;
3. the selected provider instance is still the last successfully dispatched instance;
4. the selected native cursor exists;
5. if the adapter reports `sessionModelSwitch: unsupported`, the selected model is unchanged.

`pending` always rebuilds with reason `dispatch-interrupted`; `invalidated` always rebuilds with reason `provider-reloaded`.

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
- `session.started` records a cursor but cannot make a pending thread fresh by itself;
- only a successful `turn.completed` from the matching provider instance can confirm the pending record;
- a completion from another instance cannot confirm the pending selection;
- failure to persist completion confirmation leaves the thread pending, which is slower but safe;
- provider reload writes `invalidated` before replacing the fleet;
- bot deletion removes the private freshness record after the user-visible deletion transaction succeeds.

## Scope

This solves context correctness across engine/model/session boundaries. It does not implement queued steering while a bot is busy; that is tracked separately as P0.12b.
