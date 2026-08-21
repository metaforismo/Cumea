# Computer use & browser use in Cumea

Decision doc, updated 2026-08-14. How bots in Cumea get host computer use,
isolated Local VM use, and browser use. The macOS host path is bundled; the
Local VM path is opt-in and requires Docker, Podman, or Apple container. Based on a survey of
OSS chat-app MCP hosts, macOS control servers, browser-automation stacks, and
the local `cua` / `axstream` code on this machine.

## TL;DR architecture

```
Electron main process
├── EmbeddedCuaDriverHost  ──spawns──▶  cua-driver (bundled Rust binary, Resources/)
│     one TCC prompt, named Cumea          │ unix socket (private)
├── WebContentsView pool (embedded browser, persist: partitions per bot)
│     driven via webContents.debugger (CDP) — zero-install browser use
└── server/ harness (drivers spawn agent CLIs with --mcp-config)
      ├── computer-proxy-local.ts  ──▶ forwards MCP tool calls to driver socket
      ├── computer-proxy.ts (existing) ──▶ remote/cloud box
      └── local-vm-mcp.ts ──▶ official Cua MCP inside an isolated container
```

- **Plugins = MCP servers over stdio.** The Plugins panel toggles which MCP
  servers get injected into each bot's `--mcp-config`. Same pattern as Claude
  Desktop / Cherry Studio / LibreChat.
- **Computer use = bundled `cua-driver`** (Rust, official v0.19.3 release
  executable). The pinned `darwin-arm64` release archive currently contains a
  59.1 MB universal Mach-O with both x86_64 and arm64 slices; Cumea verifies and
  preserves that upstream artifact instead of relying on a developer-machine
  checkout.
  NOT Swift — the Swift file everyone remembers
  (`examples/embedded-host-macos/ExampleAgentHarness.swift`) is a 165-line
  reference host showing the embedding pattern, not the driver.
- **Browser use = the app's own Chromium first.** Electron *is* Chromium;
  embed pages in `WebContentsView` and drive them via the built-in
  `webContents.debugger` CDP transport. No Chrome dependency, no 281MB
  Playwright download, and the user watches the bot browse inside the chat.

## Computer use: CUA only — bundle cua-driver, spawn from Electron main

**Current decision (updated 2026-08-14): CUA is the only computer-use implementation.
No cliclick, no robotjs/nut.js, no Python computer-server, no fallbacks.**
Everything that touches the user's screen/mouse/keyboard goes through the
bundled macOS `cua-driver` binary or the pinned driver inside the isolated Local VM.
Alternatives evaluated and rejected:

| Option | Verdict |
| --- | --- |
| cua `computer-server` (Python/FastAPI) | ✗ 200MB+ frozen Python, second TCC prompt under wrong identity |
| axstream / cliclick / robotjs-class | ✗ rejected — CUA-only policy |
| **cua-driver binary, embedded mode** | ✓ THE provider: zero deps, 20+ tools, its own stdio MCP proxy + socket daemon + TS SDK (`@trycua/cua-driver`), agent-cursor overlay, permission tooling |

### The rules (from `cua/libs/cua-driver/rust/Skills/cua-driver/EMBEDDING.md` — read it end to end)

1. **Spawn from the Electron main process, never from the server/gateway
   layer.** macOS TCC attributes a spawned child to its "responsible process".
   Spawned from Electron main → the grant is Cumea's, users see ONE
   prompt named Cumea, and the bundled driver inherits it. Spawned from
   a Node gateway/daemon → the identity silently becomes the gateway's and
   `check_permissions` cannot detect the misattribution. The harness must ask
   Electron main for the driver socket path over IPC, not spawn the driver.
2. Use `EmbeddedCuaDriverHost` from `@trycua/cua-driver`
   (`libs/cua-driver/typescript/src/embedded.ts`, Electron helpers in
   `src/electron.ts`: `requestMacOSPermissions`, `hasRequiredMacOSPermissions`,
   `openMacOSScreenRecordingSettings`). Working reference:
   `typescript/test/electron-main-fixture.mjs`.
3. Env: `CUA_DRIVER_EMBEDDED=1` (exact value) + `CUA_DRIVER_HOST_BUNDLE_ID`.
   Permission mode `standard`.
4. Before creating or starting `EmbeddedCuaDriverHost`, read the host-process
   status with `currentMacOsPermissionStatus()` and require
   `hasRequiredMacOSPermissions(status)`. The renderer can explicitly request
   grants or re-check them through narrow IPC, but it never receives the socket
   path or MCP launch contract. A missing/revoked grant persists a
   `needs-permissions` descriptor with no MCP command.
5. Lifecycle: defer `before-quit` until `await embedded.stop()`; after an
   explicit grant refresh, destroy/restart the generation and reconnect. Watch
   `waitForExit(generation)` to fail closed; do not auto-restart or replay an
   action whose completion is unknown.

### Packaging

- Ship the official `cua-driver-rs-v0.19.3` arm64 release binary at
  `Cumea.app/Contents/Resources/cua-driver`, prepared by
  `scripts/prepare-cua-driver.mjs` only after its pinned release asset passes
  exact byte-length and SHA-256 verification. The downloaded archive and
  extracted executable stay under ignored `build/cua-driver/`; no driver binary
  is committed. Keep it **outside the ASAR**, executable bit preserved (electron-builder
  `extraResources`).
- **Re-sign it with our Team ID** before signing + notarizing the app (the
  installed copy is signed by trycua `YCK386LBJ7`). Biggest new build step.
- Info.plist: `NSAccessibilityUsageDescription`,
  `NSScreenCaptureUsageDescription` (mirror `/Applications/CuaDriver.app`'s
  strings).
- Onboarding: check → explain in-app → deep-link Settings panes
  (`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`
  and `?Privacy_ScreenCapture`). Expect macOS 15's ~monthly screen-recording
  re-prompt; the `persistent-content-capture` entitlement is Apple-gated and
  not realistically available to us.

### MCP exposure: the official `cua-driver mcp` proxy (no custom proxy)

Do NOT hand-roll a socket proxy. The driver ships its own stdio MCP proxy:

```
cua-driver mcp                              # standalone (attaches to running daemon)
cua-driver mcp --embedded --socket <path>   # embedded (host-owned daemon)
```

It speaks line-delimited JSON-RPC 2.0 on stdin/stdout, executes nothing
itself, and forwards to the host-owned daemon. Verified round-trip against the
installed `CuaDriver.app` binary:
`tools/call get_screen_size` → `{"width":1512,"height":982,"scale_factor":1}`.

So the harness just adds one entry to a bot's `--mcp-config`:

```jsonc
{ "mcpServers": { "computer": {
    "command": "<cua-driver binary>",
    "args": ["mcp", "--embedded", "--socket", "<socketPath>"],
    "env": { "CUA_DRIVER_EMBEDDED": "1", "CUA_DRIVER_HOST_BUNDLE_ID": "io.github.metaforismo.cumea" }
} } }
```

Electron main writes that descriptor to
`<userData>/cua-connection.json` (see `electron/cua.mjs`); the harness reads
it and injects the block. The driver's own non-idempotent-action safety and
the `ax → ax_fg → cgevent → cgevent_fg → cgevent_hid` delivery ladder
(background pid-addressed input first — does not steal the user's cursor) are
handled inside the binary; the host adds nothing.

Driver tool surface (per `cua-driver list-tools`): start_session, click,
double_click, right_click, drag, scroll, type_text, press_key, hotkey,
move_cursor, get_window_state, get_desktop_state, get_accessibility_tree,
list_windows, list_apps, launch_app, bring_to_front, check_permissions,
get_screen_size, zoom, screenshot. AX element paths are preferred over pixel
coordinates and work on backgrounded/hidden windows.

### Policy: CUA is the only computer-use path

No axstream, no cliclick, no robotjs/nut.js, no Python computer-server. If a
capability is missing (e.g. OCR-anchored clicking, macro record/replay), it is
added to cua-driver upstream or requested as a driver tool — never bolted on
beside it. This keeps one TCC identity, one binary to sign/notarize, and one
behavior contract.

### Opt-in Local VM: same Cua protocol, separate trust boundary

Choosing **Local VM** never falls through to the host desktop or a cloud box. Cumea detects a
supported container runtime, then asks the user separately to prepare, create/start, stop, or remove
the managed desktop. It does not install a runtime or mutate container state merely because Settings
or the Computer panel was opened.

The derivative desktop image pins `trycua/xfce-cua` by digest and Cua Driver 0.19.3 wheels by exact
SHA-256 for x86_64 and aarch64. The container publishes only its viewer on loopback, is capped at
4 GiB RAM, 2 CPUs and 512 PIDs, drops all capabilities, and adds back only `SETUID`/`SETGID`. Labels,
image identity, port binding and hardening are revalidated before the provider becomes ready.

Agents receive Cua's official stdio MCP bridge executed as the unprivileged container user. A
per-thread exclusive lease prevents two active turns from controlling the same desktop; completion,
failure, cancellation and deletion release it. A hash-fragment viewer password stays out of server
requests, and the API exposes lifecycle actions only to the loopback desktop client. Real runtime
acceptance still requires a supported container engine and must be reported separately from unit tests.

## Browser use: three tiers

1. **Default, zero setup: embedded browser.** `WebContentsView` inside the
   chat UI, `persist:bot-<id>` session partitions (logins survive restarts,
   per-bot isolation), normalized Chrome UA. Drive via `webContents.debugger`
   (built-in CDP: `Input.*`, `Runtime.*`, `Page.*`,
   `Accessibility.getFullAXTree` for playwright-mcp-style snapshot refs) +
   `capturePage()` for vision. User can grab the mouse mid-task for logins /
   CAPTCHAs, then hand back. Known limit: Google OAuth blocks embedded
   webviews — route Google-account flows to tier 2/3.
2. **Opt-in "use my real Chrome": extension bridge.** Chrome 136+ killed
   `--remote-debugging-port` on the default profile (do NOT build the old
   CDP-relaunch flow). The surviving path is playwright-mcp `--extension`
   mode (or Browser MCP) + the Web Store "Playwright Extension" — drives the
   user's logged-in tabs via `chrome.debugger`. Requires an extension install,
   so opt-in only.
3. **Opt-in power tier: bundled `@playwright/mcp`** launching system Chrome
   (`--browser chrome`, its default — no download when Chrome exists),
   persistent profile dir so logins stick. Optionally chrome-devtools-mcp for
   perf/Lighthouse/network tasks.

Skip browser-use (Python; wants to own the agent loop; even their own desktop
app doesn't embed it).

## Rollout order

1. `computer-proxy-local.ts` + spawn `cua-driver mcp` directly from Electron
   main in dev (unsigned dev builds inherit the terminal/Electron grant).
2. Permission onboarding UI (Plugins panel → "Computer" plugin card: status,
   grant buttons, deep links).
3. Embedded browser pane + a minimal CDP toolset (navigate / snapshot /
   click-ref / type / screenshot) exposed as the "Browser" plugin.
4. Packaging: extraResources + re-sign + notarize; wire
   `EmbeddedCuaDriverHost` for production.
5. Later: axstream-style macro teach/replay, extension bridge, playwright-mcp
   tier.
