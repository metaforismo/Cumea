# External-effect receipts

Cumea records external mutations separately from ordinary tool progress. A successful tool step is
not proof that an email, calendar change, upload, payment, or other remote effect happened exactly
once.

An adapter that owns a side-effect boundary uses `WorkspaceStore.executeExternalEffect`. Cumea
writes `intended`, then durably writes `applying`, and only then calls the destination. An
acknowledged result becomes `applied`. A timeout, disconnect, generic exception, or receipt-write
failure becomes `unknown`, because the destination may already have applied the mutation. Only a
typed adapter response that proves rejection before mutation becomes retryable `failed`. If the
process disappears while `applying`, startup also changes the receipt to `unknown`. Unknown effects are never replayed
automatically and block resumable work until the desktop user independently checks the destination
and records a resolution.

Retries after a confirmed failure get a new attempt and local idempotency identity. An adapter may
instead supply a destination-issued idempotency key; Cumea persists only its digest. A duplicate
applied request reconciles to bounded result metadata. Raw request bodies, response bodies, URLs,
addresses, tokens, and credentials are never stored in the receipt.

Existing provider runtimes do not always expose request arguments before executing their native
tools. Cumea therefore classifies only explicit remote integration-shaped write tools. Those events
are recorded as `unknown` observations after the fact. Generic tools, shell commands, local file and
memory tools, peer-agent tools, browser actions, and computer actions are not falsely labeled as
external effects.

Receipts appear inside the existing task/run Activity timeline. Resolution is a loopback-only admin
operation; the paired companion receives only per-run receipt and unsafe counts, without hashes,
targets, audit notes, or a replay/resolution endpoint. Portable backups include the bounded audit
receipts but no request data or authority.
