# Computer backend contract

Cumea currently has two useful computer implementations with different transports: the Electron-owned local CUA
runtime and the optional Box cloud computer. The product roadmap also calls for user-owned Docker/BYO-VPS and
explicit Team/Project computers. Those implementations must converge on a **capability and ownership contract**
before the UI starts treating every computer as interchangeable.

`server/computer-backend.ts` is the provider-neutral foundation for that work. It does not replace the current
computer drivers in this tranche; it defines the invariants they must be adapted behind in focused follow-ups.

## Scope is explicit

A computer is either:

- `private` — owned by one durable bot identity; or
- `shared` — owned by one explicit project/team identity.

Shared files do not imply shared graphical control. A project may permit several runs to read/write a shared
workspace while still allowing exactly one run at a time to drive a graphical session.

## Capabilities degrade independently

Every public descriptor reports four separate capabilities:

- `shell`
- `files`
- `graphical`
- `checkpoints`

A transport may therefore remain useful when no desktop session exists. For example, a BYO VPS can be reachable
for shell/files while its graphical session is missing; Cumea should report that honestly instead of collapsing
both into one generic unavailable state.

Availability also distinguishes `missing`, `transport-error`, `unavailable`, `provisioning`, and `ready`.
User-visible transport messages are bounded and normalized; backend credentials, SSH aliases and raw provider
objects are not part of `ComputerDescriptor`.

### Capability bits require runtime evidence

A TypeScript field is not evidence that an adapter can perform an operation. `validateComputerBackendConformance`
therefore fails closed when a descriptor advertises a capability without the minimum corresponding primitive:

- `shell` requires `exec`;
- `files` requires both `readFile` and `writeFile`;
- `graphical` requires a screenshot/graphical-session primitive;
- `checkpoints` requires both create and restore;
- the descriptor backend kind must match the adapter kind.

An implementation may expose a method while advertising the capability as false for a particular unavailable
instance. The reverse is forbidden. This lets the UI consume capability bits without silently promising a tool
that the selected backend cannot supply.

The first contract intentionally does **not** invent a generic mouse/keyboard protocol. At this layer,
`graphical=true` proves that a graphical session/preview primitive exists; actual control remains behind the
existing provider-specific MCP/control transport until local CUA and Box are adapted in later conformance PRs.
Those adapters must not claim generic graphical **control** merely because the screenshot primitive passes this
foundation gate.

## Graphical leases are fenced

`ComputerLeaseFence` is process-local fencing for graphical input ownership. Each successful acquisition receives
both a random lease ID and a monotonically increasing per-computer generation.

The important property is that a stale completion cannot release a newer run's screen:

1. run A acquires generation 1;
2. an authorized takeover replaces it with run B, generation 2;
3. a late `release()` from run A returns false and leaves generation 2 untouched.

Renew, assert, release and takeover all require the exact current fence. Expired leases are removed before reuse,
and a new acquisition increments the generation rather than resurrecting the old lease.

This is the base invariant required before human takeover, Team/Project screens or multiple sandbox providers can
share one UI safely. It is process-local deliberately: durable lease ownership/recovery belongs to the adapter /
run orchestration tranche that actually binds computers to persisted runs, where restart semantics can be tested
against the authoritative run store rather than guessed inside a generic utility.

## Checkpoints are provider-neutral

The backend interface exposes optional `createCheckpoint` / `restoreCheckpoint` operations and a portable flag on
checkpoint metadata. The first Box/local adapters do not need to claim checkpoint support immediately; capability
bits must remain false until a real implementation and evidence exist.

Future portable workspace export/import should be expressed above provider-native snapshot IDs. Cumea must not
make team portability depend on one sandbox vendor's image format.

## Security consequences for BYO VPS

The future BYO-VPS adapter remains constrained by the roadmap audit:

- user preconfigures an SSH alias; Cumea does not store a private key;
- host keys are never auto-accepted;
- managed containers expose no public ports;
- status/lock/transport calls are bounded;
- missing container and transport failure are distinct states;
- Cumea verifies ownership labels before operating on an existing container;
- disposable filesystem behavior is explicit;
- the SSH alias is backend-private and never projected to mobile.

The generic descriptor intentionally has nowhere to put an SSH private key, bearer token, or arbitrary provider
configuration object.

## Current evidence boundary

This tranche proves the contract types, bounded public projection, private/shared scope validation, runtime
capability-to-primitive conformance and stale-lease fencing with deterministic tests. It does **not** yet claim
that local CUA or Box have been migrated behind the new interface, that graphical input is provider-neutral, or
that BYO VPS / shared project computers exist. Those remain P1.12 implementation follow-ups.
