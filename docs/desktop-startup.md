# Packaged desktop startup

Cumea deliberately separates three readiness states on the packaged desktop:

1. **desktop shell available** — the local renderer can load its packaged UI;
2. **agent host available** — the local harness has completed its provider/store bootstrap and can serve `/api/*`;
3. **local computer available** — the optional CUA integration has reconciled permissions and, when allowed, started its native host.

These states are not interchangeable. The application should remain inspectable while a later state is still starting or degraded.

## Stable desktop origin

The packaged renderer uses a small Electron-owned HTTP gateway on:

```text
http://127.0.0.1:8799
```

The port remains stable because Chromium storage is origin-scoped. Moving the renderer to an arbitrary port on every launch would create a different origin and make local renderer state such as onboarding appear to reset.

The gateway:

- binds IPv4 loopback only;
- requires the exact numeric loopback `Host` header for its own port before serving UI or API, preventing a DNS-rebound hostname from being treated as the desktop origin;
- serves the packaged Vite output itself;
- returns a bounded `503` for `/api/*` while no verified harness is attached;
- streams API requests, downloads, and SSE to one internally selected loopback harness port;
- never accepts an arbitrary upstream host or URL;
- constrains decoded static paths beneath the packaged UI root;
- returns `404` for missing file-like assets rather than serving the SPA HTML with the wrong MIME type;
- applies a same-origin CSP to HTML;
- strips static and `Connection`-named hop-by-hop headers;
- reasserts its own security headers on proxied responses rather than letting the private upstream weaken them;
- rewrites `Origin` only when it exactly equals the gateway's own renderer origin, translating it to the private harness origin so the harness's CSRF/origin boundary remains effective;
- leaves foreign origins unchanged so the harness can reject them.

An unrelated process already occupying the stable desktop port is never trusted as Cumea. The packaged window falls back to an internal error document instead of navigating to the occupant.

## P0.03a startup sequence

The current sequence is:

```text
Electron ready
→ initialize packaged credential-storage boundary
→ register display/CUA IPC
→ write a harmless lazy-CUA descriptor
→ bind the desktop gateway
→ create + navigate BrowserWindow
→ start harness asynchronously
→ verify the exact child PID through the existing bounded health probe
→ attach the gateway to that harness port
→ EventSource reconnects and canonical state hydrates
```

The renderer therefore no longer waits for provider discovery or harness readiness before it can paint.

While the harness is unavailable the gateway exposes only one of three fixed public states:

```text
agent host is starting
agent host is restarting
agent host could not start
```

Internal child diagnostics, filesystem paths, and provider errors are not projected through this pre-readiness surface.

### Temporary control-plane limitation

P0.03a intentionally keeps the pre-existing bounded HTTP health probe and a separate harness fallback-port set:

```text
18799
28799
38799
```

Those ports are now outside the renderer's critical path, but they are not the final architecture. The private harness listener is still directly reachable on loopback during this tranche; the gateway's exact-Host protection therefore hardens the stable renderer surface but is not presented as a complete replacement for hardening the backend listener itself.

P0.03b must replace the fixed backend ports and finish the private-listener boundary with:

```text
CUMEA_PORT=0
→ operating system chooses the harness port
→ child validates its local listener Host/origin contract
→ child sends {kind, version, pid, port} through Electron UtilityProcess messaging
→ parent validates exact child PID + bounded port
→ gateway attaches to the announced port
```

The message contract is already covered by `electron/harness-process.test.mjs`; it is not yet active in P0.03a and must not be described as shipped behavior.

## Harness restart contract

Credential replacement may require a new harness because packaged credentials are supplied only during child bootstrap.

The gateway target is cleared before the old child is stopped. During this interval the renderer remains on its stable origin and sees a bounded restart state instead of being navigated or pointed at an unverified process.

Initial startup and credential-triggered restarts share one serialized transition queue. App shutdown sets a latch before cleanup so an in-flight startup probe cannot spawn another fallback child while the application is quitting.

An unexpected harness exit also clears the target. This matters because leaving the old port attached would allow a later unrelated process that reused that port to receive Cumea renderer traffic.

## Lazy local-computer initialization

Local computer support no longer belongs to normal startup's critical path.

At launch Electron only replaces any stale persisted CUA descriptor with:

```text
state: unavailable
reason: local computer control starts when requested
```

This operation does not import the CUA SDK, read macOS TCC state, probe the standalone socket, or start the embedded daemon.

The existing `cua:status`, permission-request, and retry IPC operations perform the real reconciliation when the user opens or uses that capability. The harness reads the CUA descriptor from disk when preparing a local-computer turn, so later readiness does not require rebuilding the provider fleet.

## Renderer reconnection behavior

The current store already treats the SSE stream as reconnectable. Before harness readiness:

- the initial API calls can fail with `503`;
- `EventSource` retries against the same stable origin;
- after the gateway receives a verified target, the normal `hello` path reloads bots, configuration, workspace state, and other canonical projections.

P0.04 will replace the collection of initial reloads with one bounded atomic bootstrap. P0.03a does not claim that work is complete.

## Performance interpretation

P0.03a changes what can paint before the harness is ready. That makes phase naming important:

- `shell-painted` means the packaged UI rendered; it does **not** prove the harness is ready;
- `shell-usable` still requires the existing connected/config/agent condition and therefore remains a later state;
- first-run onboarding paint can now occur while the harness is still starting;
- `main.server-startup` remains a separate harness-readiness measurement.

Do not compare a pre-P0.03 first-run paint sample and a post-P0.03 first-run paint sample as though they measured identical startup work without stating the changed sequencing. No performance improvement should be published until matching scenarios are repeated on the fixed-machine evidence gate tracked by P0.01c/P0.03c.

## Failure boundaries

P0.03a intentionally does not claim:

- an OS-assigned harness port;
- parent/child readiness messaging in production;
- complete direct-harness DNS-rebinding hardening before the P0.03b listener rewrite;
- atomic renderer bootstrap;
- fixed-machine startup improvement numbers;
- signed/notarized packaged-launch acceptance;
- local-computer readiness before the user requests it.

Those are separate gates in `TODO.md`.
