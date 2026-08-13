# Secure file previews

Cumea treats every path printed by an agent as untrusted text. The desktop and
web UI never opens a `file://` URL, invokes the OS shell, or receives a real
host path. A click asks the local host to resolve a file inside one explicit
workspace and returns an opaque, random, short-lived read capability.

## Trust boundaries

- Local agent output is restricted to `~/.cumea/bot-workspaces/<bot-id>`.
  Providers receive that directory as their turn working directory.
- Cloud-computer output must live below `/workspace`. Resolution is performed
  on the owner-scoped VM, copied to a random snapshot, then read through the
  Box file API. The original path is never returned to the browser.
- Uploaded attachments are resolved only from their server-side store record;
  no client-supplied path is accepted.
- Capabilities contain 256 bits of randomness, expire after 30 minutes, are
  held only in memory, are capped at 64 handles / 96 MB, and are revoked when
  the bot is deleted. Preview and download endpoints are same-origin and
  local-host only, with `no-store` and `nosniff` headers.

Local reads require lexical and canonical containment, a regular non-symlink
file, a descriptor opened with `O_NOFOLLOW` where available, stable metadata,
and a bounded snapshot. This prevents traversal and common symlink/path-swap
attacks. It does not try to isolate an already-compromised host process with
the same user privileges; OS-level sandboxing remains the boundary for that
threat.

## Formats and limits

- Markdown: UTF-8 text only, maximum 5 MB. It is rendered as React text nodes;
  raw HTML is never interpreted.
- PDF: signature and EOF marker required, maximum 25 MB. The UI fetches the
  capability bytes with `no-store` and gives them directly to the pinned,
  locally bundled PDF.js worker—never a URL chosen by the document. Cumea
  renders one page at a time on a bounded canvas (16 megapixels, 8,192 px per
  edge, 50–300% zoom), exposes only its own keyboard controls, and provides a
  bounded current-page text reading path. No iframe, browser PDF plugin,
  `file://` URL, external worker, annotation layer, or document script is
  involved. Direct navigation to the byte endpoint downloads the file; the
  response remains `no-store`, `nosniff`, same-origin-only, and frame-denied.
- DOCX: maximum 20 MB compressed, 512 entries, 8 MB per entry, 32 MB expanded,
  and a 100:1 per-entry compression ratio. The parser rejects unsafe archive
  paths, DTD/entities, external relationships, macros, ActiveX, OLE, and
  embedded objects. It returns safe semantic text blocks, not document HTML.

Complex Word layout, images, comments, tracked changes, and exact pagination
are intentionally outside the semantic preview. The original remains
available through the capability-scoped download action.
