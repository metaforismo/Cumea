# Local file capability routes

This tranche activates the owner-local file capability primitives only on the trusted desktop harness.
It does not add a renderer or expose any file capability to paired/mobile clients.

## Authority model

A renderer or model never sends a host filesystem path that Cumea trusts directly. Desktop callers may
ask the harness to resolve either:

- a relative path inside the exact Cumea-owned workspace for one bot; or
- a Workspace attachment ID whose `storedPath` is looked up by the host.

The server snapshots the bytes through `FileCapabilityStore` and returns only an opaque expiring token,
a sanitized file name, type/size/source metadata, and local relative preview/download routes. No host
path is projected.

## Local-only routes

- `POST /api/bots/:botId/files/resolve`
- `POST /api/attachments/:attachmentId/files/resolve`
- `GET /api/files/:token/preview`
- `GET /api/files/:token/download`

All four routes fail closed on the paired/mobile listener, even after valid device authentication.
Capabilities are therefore not remote bearer credentials.

Markdown and DOCX preview responses are inert structured JSON produced by the bounded semantic parser.
PDF preview returns the validated PDF snapshot bytes for the future PDF.js renderer. Unknown/binary
files are download-only and a preview request fails with an unsupported-media response.

## Provider workspace boundary

Host-running providers receive the exact per-bot owner-local workspace as their working directory and
are asked to cite user-facing files with relative paths. A cloud-computer provider owns a different
filesystem; its files are not silently mapped into the host workspace. Cloud file handoff belongs to the
pluggable computer-backend contract rather than this local capability surface.

## Deletion

The per-bot workspace is staged in same-volume quarantine together with the existing bot deletion
transaction. Successful deletion revokes every in-memory file capability for the bot. A failed prepare or
metadata commit keeps the staged directory available for rollback; irreversible purge failures retain the
same explicit incomplete-rollback boundary as the existing attachment/event-log deletion transaction.

## Evidence

`server/file-preview.integration.test.ts` starts the real harness with both loopback listeners and proves:

- relative contained resolution succeeds without exposing the data directory;
- traversal outside the bot workspace is denied;
- Markdown preview and download are `no-store` and bounded by the underlying capability;
- binary content can download but cannot preview;
- attachments resolve only through their host-owned attachment record;
- authenticated remote/mobile requests cannot resolve, preview, or download capabilities;
- bot deletion removes its owner-local workspace and revokes both workspace and attachment capabilities.

Desktop rendering, PDF.js, focus trapping, file-link recognition, and browser visual/accessibility evidence
remain a separate P0.00a2c gate.
