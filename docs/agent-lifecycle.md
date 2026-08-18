# Agent lifecycle watchdog

> **Verification boundary:** P0.12a is covered by the root test/typecheck matrix on macOS, Ubuntu and Windows, the production build/SBOM gate, mobile test/typecheck/export, landing build and unsigned macOS arm64 package-layout smoke. These gates do not establish signed-release, physical-device, or provider-process failure acceptance on every supported environment.

P0.12a makes long-running agent work observable without treating a timer as proof that an external provider is dead.

## States

A tracked Work run can project one of four lifecycle states:

- `working` — runtime activity has been observed within the expected window;
- `waiting` — the provider has an unresolved permission/question and is explicitly waiting for the user;
- `no_signal` — Cumea still considers the turn active, but no canonical runtime signal has arrived for the no-signal window;
- `dead` — the no-signal period crossed the longer dead-observation window.

`no_signal` and `dead` are observations, not process-termination commands. The watchdog never interrupts a provider merely because a threshold elapsed.

Default source-runtime thresholds are 90 seconds for `no_signal` and five minutes for `dead`. The in-memory watchdog ticks every 15 seconds, but durable Workspace writes happen only when the visible lifecycle meaning changes. Ordinary token/tool heartbeats therefore do not rewrite `workspace.json` every tick.

## Waiting-on-human exemption

`request.opened` with a provider request ID moves the tracked run to `waiting`. While at least one provider request is unresolved, the run is exempt from silence/dead timers regardless of elapsed wall time.

`request.resolved` returns the watchdog to `working`, but provider attention remains independently owned by the existing approval/question flow until `WorkspaceStore.resumeRun()` processes that request. A lifecycle heartbeat cannot dismiss an approval card.

## Repeated-effect detector

The watchdog also records normalized tool/effect titles. Six identical effects inside the default two-minute window produce a single advisory `repeated_effect` alert for that repeat sequence.

The detector is deliberately bounded and does not kill or pause the provider. A different effect or a new repeat window re-arms detection. Once surfaced in Work / Needs You, a repeated-effect alert remains visible until the run settles or the user stops the current turn; unlike a recovered silence alert, a later heartbeat does not immediately hide it.

## Work and Needs You ownership

`RunRecord.attentionKind` separates:

- `provider` — a real permission/question owned by the provider request protocol;
- `lifecycle` — a watchdog recovery observation.

Lifecycle alerts add a `lifecycle` Work step and move the task/run to `needs_attention`. Work shows the current lifecycle state, reason and recovery warning. The agent keeps running unless the user chooses to steer it or stop the current turn.

If activity resumes after `no_signal` or `dead`, Cumea completes the lifecycle recovery step and returns the run/task to `running`. It never performs that automatic recovery while `attentionKind === provider`.

## Persistence and restart

The high-rate monitor state is process-local. Only user-visible lifecycle transitions and lifecycle alerts are persisted into the existing Workspace record. Cumea's existing Workspace startup recovery marks unfinished runs failed after a harness restart, so the new process never claims an old provider process is still alive.

The companion/mobile Work projection receives only the structural lifecycle state/reason/timestamps and attention kind. It does not receive raw runtime events, provider-native errors, command lines, credentials or session cursors.

## Scope

This tranche does not add automatic process restart, automatic retry, effect idempotency or a durable effect journal. Those require stronger effect/reconciliation boundaries and remain separate roadmap work.
