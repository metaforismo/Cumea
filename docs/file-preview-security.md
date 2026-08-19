# Local file preview security boundary

Cumea treats paths mentioned by a model as untrusted text. A model response must never become a host
filesystem read merely because it contains something that looks like `/Users/...`, `C:\\...`, or a
relative path.

P0.00a is split deliberately:

1. **Capability foundation (P0.00a1).** Establish the only owner-local files that can become readable,
   snapshot them through a bounded capability store, and make bot-workspace deletion rollback-capable.
2. **Bounded semantic parsing (P0.00a2a).** Keep Markdown as inert text and parse DOCX through Cumea's
   own bounded ZIP/XML reader using only Node built-ins. Do not expose routes or render the result yet.
3. **HTTP + renderer activation (P0.00a2b).** Resolve a user-selected/cited logical path or host-owned
   attachment identifier into a capability, point providers at the exact bot workspace, and expose
   local-only preview/download routes plus inert Markdown/DOCX UI.
4. **PDF renderer and browser acceptance (P0.00a2c).** Add a bounded PDF.js renderer, dependency
   notices/SBOM/package evidence, focus/keyboard behavior, and the real-browser journey.

This separation keeps filesystem authority, archive parsing, HTTP authority, and renderer supply-chain
risk independently reviewable.

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

The capability foundation recognizes Markdown, PDF and DOCX only enough to establish a type boundary:

- Markdown must be valid UTF-8 without NUL bytes;
- PDF must have a PDF header and an EOF marker near the end;
- DOCX must begin with a ZIP signature;
- unknown types remain `binary` and are download-only.

The semantic parser adds a much stronger DOCX boundary before any rich preview is activated.

## Dependency-free DOCX preflight

`server/document-preview.ts` intentionally does **not** hand the archive to JSZip or another generic
ZIP library. It reads the fixed ZIP metadata itself and rejects the archive before decompression when
any of these invariants fail:

- archive size exceeds 20 MiB;
- more than 512 entries are declared;
- ZIP64, multi-disk, encryption, data descriptors, or unsupported compression are used;
- a path is absolute, traverses upward, uses Windows-style separators, duplicates another member, or
  points at known active Word content such as VBA, ActiveX, OLE, or embedded objects;
- central and local headers disagree about name, flags, method, CRC, sizes, or offsets;
- one member would expand past 8 MiB, total declared output passes 32 MiB, or a compression ratio
  exceeds 100:1;
- the central directory is malformed, overlaps payloads, or leaves unparsed bytes before EOCD.

Only stored and DEFLATE members are accepted. Required XML is inflated with Node's built-in `zlib`
after preflight, with a hard output cap, exact uncompressed-size check, and CRC32 verification.

## Passive XML and semantic projection

The parser reads only the package metadata/relationship XML plus `word/document.xml`. It rejects
DOCTYPE/ENTITY declarations, external relationships, macro-enabled content types, and unknown/invalid
XML entities.

The output is not HTML. It is a small structured projection containing only headings, list items and
paragraph text. Tabs and line breaks are represented as text characters. The projection is bounded to
5,000 blocks and 2,000,000 characters; excess content is truncated deterministically with a visible
warning. Complex layout, images, comments and tracked changes are deliberately not projected.

Markdown remains inert source text. A future renderer may parse only the safe subset it explicitly
implements; raw Markdown HTML must not become executable DOM.

PDF remains a separate renderer problem. Signature validation is not sufficient to parse arbitrary PDF
content safely, so PDF bytes are not considered richly previewable until P0.00a2c adds a bounded PDF.js
worker/canvas contract and package evidence.

## Deletion and rollback

Bot workspace removal participates in the same staged-deletion philosophy as transcripts and
attachments. The exact per-bot directory is renamed into a Cumea-created same-volume quarantine before
irreversible deletion. The surrounding bot transaction can then either purge the quarantine or rename
it back on rollback.

No recursive delete accepts a path supplied by a model or renderer.

## Evidence boundary

The capability tests cover containment, path traversal, sibling access, supported final-symlink
rejection, format spoofing, token expiry/revocation, bounded eviction, and workspace quarantine
rollback. The document-parser tests cover stored/deflated members, CRC verification, ZIP64,
encryption/data-descriptor rejection, local/central mismatch, path traversal, duplicate entries, active
content, external relationships, XML declarations/entities, compression bombs, entry-count limits, and
semantic truncation.

No new file route or viewer is advertised as available to users until P0.00a2b/P0.00a2c activate and
exercise those surfaces on the exact candidate commit.
