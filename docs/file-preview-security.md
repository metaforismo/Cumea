# Local file preview security boundary

Cumea treats paths mentioned by a model as untrusted text. A model response must never become a host
filesystem read merely because it contains something that looks like `/Users/...`, `C:\\...`, or a
relative path.

P0.00a is therefore split deliberately:

1. **Capability foundation (P0.00a1).** Establish the only owner-local files that can become readable,
   snapshot them through a bounded capability store, and make bot-workspace deletion rollback-capable.
2. **HTTP + renderer activation (P0.00a2).** Resolve a user-selected/cited logical path or host-owned
   attachment identifier into that capability, then render Markdown/PDF/DOCX through inert bounded
   viewers. This second tranche is where PDF.js/JSZip supply-chain and decompression budgets belong.

The first tranche is useful even before activation because it creates one small API-independent
invariant for every later file surface to consume.

## Workspace boundary

Local agent-created deliverables live under one Cumea-owned root:

`~/.cumea/bot-workspaces/<bot-id>/`

(or the equivalent child of `CUMEA_DATA_DIR`). The root and exact bot child must be real directories,
not symlinks. The resolver requires both lexical containment and realpath containment. The final path
component must be a regular file and cannot be a symlink.

When the HTTP activation tranche lands, provider `cwd` will point to that exact bot workspace. A model
will be encouraged to cite a logical relative path such as `./report.md`; the renderer will never need
the corresponding host path.

Managed uploads use the existing Workspace attachment record. The client will send only the attachment
identifier; Cumea looks up the store-owned `storedPath` server-side before creating a capability.

## Snapshot invariants

A file is snapshotted only when all of the following hold:

- it is a regular file and is not empty;
- it is at most 25 MiB;
- its resolved location remains inside the owning Cumea directory;
- opening uses `O_NOFOLLOW` where the platform exposes it;
- descriptor identity/size and the canonical path are checked around the read;
- a change observed during the snapshot fails closed instead of returning ambiguous bytes.

A capability stores copied bytes, not a path. Later preview/download requests therefore cannot be
redirected by replacing a source file after the capability was issued.

## Capability lifetime and memory

Capabilities are process-local opaque 256-bit bearer tokens. They expire after 30 minutes, are
revoked as a group when their bot is deleted, and are bounded to 64 live entries / 96 MiB aggregate
snapshot bytes. Old entries are evicted before a new issue can exceed those limits.

The public projection includes only a token, sanitized basename, validated kind/MIME, source class,
size, expiry, and relative preview/download endpoints. Host paths are never retained in the public
object.

## Format classification

The foundation recognizes Markdown, PDF and DOCX only enough to establish a safe type boundary:

- Markdown must be valid UTF-8 without NUL bytes;
- PDF must have a PDF header and an EOF marker near the end;
- DOCX must begin with a ZIP signature;
- unknown types remain `binary` and are download-only.

This is **not** a claim that PDF/DOCX bytes are safe to parse. P0.00a2 must use a bounded inert PDF
renderer and a decompression-bomb-aware semantic DOCX parser before enabling rich preview.

## Deletion and rollback

Bot workspace removal participates in the same staged-deletion philosophy as transcripts and
attachments. The exact per-bot directory is renamed into a Cumea-created same-volume quarantine before
irreversible deletion. The surrounding bot transaction can then either purge the quarantine or rename
it back on rollback.

No recursive delete accepts a path supplied by a model or renderer.

## Evidence boundary

The foundation tests containment, path traversal, sibling access, supported final-symlink rejection,
format spoofing, token expiry/revocation, bounded eviction, and workspace quarantine rollback. Until
P0.00a2 lands, no new file route or viewer is advertised as available to users.
