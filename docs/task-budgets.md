# Task budgets

Desktop users can optionally bound a task before sending it. Budgets are durable task policy, while
each run stores its own observed usage. Retries therefore remain visible and cannot reset aggregate
tool, computer, delegation, or token limits.

Supported limits are duration, tool calls, mutating computer actions, peer delegations, and tokens.
Duration begins when the canonical run is created, before provider lookup or computer provisioning,
so a slow setup cannot evade the deadline. Screen capture and read-only screen observation do not
count as computer actions. Cumea does not currently expose a retry-count limit because provider tool
titles are not a reliable retry identity; explicit external-effect attempts have their own durable
receipt ledger.

Token accounting activates only after two canonical cumulative usage snapshots establish a per-run
delta. A provider that emits no telemetry, or only one snapshot, is shown as unavailable rather than
estimated. Old cumulative thread totals are never charged to a new run.

When a limit is reached, Cumea first records the exhaustion in the task/run audit, closes event
admission, and requests one provider interruption. It does not synthesize an assistant answer.
Manual stop remains a distinct `interrupted`/`cancelled` outcome. Paired mobile clients cannot create
or widen budgets and their narrowed workspace projection omits policy and token baselines.
