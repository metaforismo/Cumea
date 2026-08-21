# Reusable local skills

Cumea local skills are versioned, instruction-only workflow packages. Version 1 intentionally has no scripts, hooks, binaries, assets, network installer, dependency resolution, or automatic execution.

Each immutable version lives below the managed Cumea data directory and contains exactly `manifest.json` and `instructions.md`. The strict manifest binds a stable package id and SemVer version to the UTF-8 instruction content with SHA-256. Names, descriptions, provenance labels, timestamps, sizes, package counts, version history, and per-agent assignments are bounded and validated on reload. Symlinks, traversal, unsupported files, malformed UTF-8, digest mismatches, and corrupt manifests fail closed.

Packages created in the editor or imported as bounded JSON are always labelled `local-unsigned`. Cumea does not claim signature verification or trust. Updates create a newer immutable SemVer version. Rollback is an explicit per-agent move to an older available version. Assigned versions cannot be disabled or deleted until they are unassigned.

Only enabled exact versions explicitly assigned to an agent enter its provider system context. Instructions are serialized as JSON inside a system-owned untrusted-data envelope. Cumea states that user requests, safety rules, approvals, and provider policy take precedence; delimiter-looking or prompt-injection-looking package text remains data and grants no permission.

Administration, full manifests, provenance, digests, content, assignment, rollback, and deletion are desktop-local. Paired mobile clients receive none of those fields. Full portable backups include validated local-unsigned package content and assignments; agent-only backups omit assignments and packages so they cannot create dangling or unexpected host authority.

Signature and network installation support are deliberately absent. Adding signatures later requires canonical bytes, Ed25519 verification, an explicit local trust store, revocation/update semantics, and separate UI language for cryptographic verification versus author trust.
