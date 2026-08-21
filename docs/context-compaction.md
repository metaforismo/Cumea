# Deterministic context compaction

Cumea compacts history only when a provider consumes replay transcripts or when rewind/checkpoint
recovery explicitly starts a fresh provider session. Native resumable sessions do not receive a
compaction record and Cumea makes no savings claim for them.

The policy is deterministic and bounded by UTF-8 bytes and message count. It retains original roles,
the first surviving user objective, later user messages, and recent exchanges. Giant messages use a
predictable Unicode-safe head/tail excerpt. Abandoned branches and messages before a Fresh context
boundary never enter the candidate set. The current user request remains outside replay history.

No model writes a summary. Fresh-session providers receive original-role excerpts as JSON inside a
clearly delimited system-owned **untrusted historical data** block. Control characters are escaped;
old assistant text is never promoted into a synthetic user instruction or treated as verified fact.
Omissions are explicit.

Runs persist only structural statistics, policy version, and a digest of selected message identities.
The token value is visibly an estimate and never contributes to provider-reported token/cost budgets.
Mobile receives only a compacted flag and omitted count. `scripts/benchmark-context-compaction.ts`
is an offline structural throughput benchmark, not evidence about answer quality, token billing,
provider cost, or savings.
