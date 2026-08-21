# Objective evidence

Cumea keeps task completion and acceptance verification as separate facts in the existing task/run
audit. A completed provider run says that the provider stopped successfully; it does not prove the
requested outcome.

In **Work → Activity**, a desktop user can add bounded acceptance requirements and attach an observed
canonical run step or artifact. The record stores its source, timestamp, stable run/reference IDs,
and a SHA-256 digest of the canonical record snapshot. This makes later changes visible without
executing a command or trusting assistant prose.

Evidence levels have deliberately narrow meanings:

- `claimed`: a claim exists, but Cumea has not observed supporting state;
- `observed`: a user attached a canonical task/run record;
- `verified`: an explicitly configured trusted verifier independently checked it;
- `rejected`: the verifier or review rejected the requirement.

The desktop HTTP API can create requirements and observations, but has no route that accepts
`verified` from a client. Provider output, tool completion, and response text are never promoted
automatically. The server exposes a typed verifier integration point for future explicit verifiers;
none are run automatically today.

The mobile companion receives only the existing narrowed task/run projection. It cannot administer
verification policy and does not receive requirement text, evidence labels, output, filesystem paths,
verifier metadata, or digests.
