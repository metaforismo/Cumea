import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell, systemPreferences, utilityProcess } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicCuaStatus, startCua, stopCua, registerCuaIpc } from "./cua.mjs";
import { startSpeech, stopSpeech } from "./speech.mjs";
import { createPerformanceRecorder } from "./performance.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 127.0.0.1 explicitly — vite binds IPv4; a bare "localhost" here can
// resolve to ::1 and paint a black window
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://127.0.0.1:5199";
let SERVER_PORT = 8799;
const APP_ICON = path.join(__dirname, "resources/app-icon.png");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const performanceRecorder = createPerformanceRecorder({
  outputFile: process.env.CUMEA_PERFORMANCE_FILE,
  metadata: () => ({
    ...(process.env.CUMEA_PERFORMANCE_LABEL
      ? { label: process.env.CUMEA_PERFORMANCE_LABEL.slice(0, 120) }
      : {}),
    ...(process.env.CUMEA_PERFORMANCE_SAMPLE
      ? { sample: process.env.CUMEA_PERFORMANCE_SAMPLE.slice(0, 40) }
      : {}),
    ...(process.env.CUMEA_PERFORMANCE_COMMIT || process.env.GITHUB_SHA
      ? { commit: (process.env.CUMEA_PERFORMANCE_COMMIT || process.env.GITHUB_SHA).slice(0, 80) }
      : {}),
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }),
});
performanceRecorder.markMain("cumea:main:module-evaluated");
app.once("will-finish-launching", () =>
  performanceRecorder.markMain("cumea:main:will-finish-launching"),
);
app.once("ready", () => performanceRecorder.markMain("cumea:main:ready"));

ipcMain.on("performance:renderer-mark", (_event, payload) => {
  const recorded = performanceRecorder.recordRenderer(payload);
  if (!recorded || payload?.name !== "cumea:renderer:shell-usable-painted") return;
  performanceRecorder.flush();
  if (process.env.CUMEA_PERFORMANCE_AUTO_QUIT === "1") {
    setImmediate(() => app.quit());
  }
});

function isSafeExternalUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

// Packaged: the harness server ships in Resources (compiled JS, zero deps)
// and runs on Electron's own Node via utilityProcess. It serves the built
// UI too, so the window talks to one origin and there is no dev proxy.
// A stray server on the default port must not brick the app — fall back to
// alternate ports until one binds AND identifies as ours (the probe checks
// our API shape, not just a 200).
let serverProc = null;
let serverReady = true;
async function startServerOn(port) {
  const entry = path.join(process.resourcesPath, "server", "index.js");
  const proc = utilityProcess.fork(entry, [], {
    env: {
      ...process.env,
      CUMEA_STATIC_DIR: path.join(process.resourcesPath, "ui"),
      CUMEA_PORT: String(port),
      CUMEA_CUA_CONNECTION: path.join(app.getPath("userData"), "cua-connection.json"),
    },
    stdio: "inherit",
  });
  let exited = false;
  proc.once("exit", () => {
    exited = true;
  });
  // wait for the port to answer (fresh machine: first boot writes data dirs).
  // Identity check is by PID: a dev harness server has the same API shape,
  // so only the child we actually forked (matching pid + static serving)
  // counts as ours.
  for (let i = 0; i < 40; i++) {
    if (exited) return null;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.app === "cumea" && body.pid === proc.pid && body.static) return proc;
        break; // someone else owns this port — try the next one
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    proc.kill();
  } catch {}
  return null;
}

async function startServerPackaged() {
  // two passes: a quit-and-reopen relaunch can race the dying instance's
  // server during teardown — one settle-and-retry covers it
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const port of [8799, 18799, 28799]) {
      const proc = await startServerOn(port);
      if (proc) {
        serverProc = proc;
        SERVER_PORT = port;
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

const ERROR_PAGE =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#070707;color:#fcfcfc;font:15px -apple-system,system-ui"><div style="text-align:center;max-width:360px"><div style="font-size:40px">◉</div><h2 style="font-weight:600;margin:12px 0 6px">Couldn't start the agent server</h2><p style="color:#fcfcfc99;line-height:1.5">Something else is using its ports. Quit and reopen Cumea — if it keeps happening, restart your computer.</p></div></body>`,
  );

function createWindow() {
  performanceRecorder.markMain("cumea:main:window-create-start");
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    icon: APP_ICON,
    backgroundColor: "#070707",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  performanceRecorder.markMain("cumea:main:window-created");
  win.once("show", () => performanceRecorder.markMain("cumea:main:window-shown"));
  if (win.isVisible()) performanceRecorder.markMain("cumea:main:window-shown");
  win.once("ready-to-show", () => performanceRecorder.markMain("cumea:main:ready-to-show"));
  win.webContents.once("dom-ready", () => performanceRecorder.markMain("cumea:main:dom-ready"));
  win.webContents.once("did-finish-load", () =>
    performanceRecorder.markMain("cumea:main:did-finish-load"),
  );

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const allowedOrigin = app.isPackaged ? `http://127.0.0.1:${SERVER_PORT}` : new URL(DEV_URL).origin;
    try {
      if (new URL(url).origin === allowedOrigin) return;
    } catch {}
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url).catch(() => {});
  });

  const url = app.isPackaged
    ? serverReady
      ? `http://127.0.0.1:${SERVER_PORT}`
      : ERROR_PAGE
    : DEV_URL;
  performanceRecorder.markMain("cumea:main:load-url-start");
  void win.loadURL(url).then(
    () => performanceRecorder.markMain("cumea:main:load-url-resolved"),
    () => performanceRecorder.markMain("cumea:main:load-url-rejected"),
  );
  return win;
}

// "This Mac" screen preview — served from the main process so TCC attribution
// stays with Cumea. The CUA state gate prevents capture or prompting until the
// official SDK has confirmed both required grants.
ipcMain.handle("screen:frame", async () => {
  if (publicCuaStatus().state !== "ready") return null;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 800 },
  });
  return sources[0]?.thumbnail.toDataURL() ?? null;
});

// Onboarding permission checks. Status reads are free; the mic request
// pops the real TCC prompt attributed to the app.
//
// CUA Accessibility/Screen Recording permission requests use the official SDK
// in cua.mjs. These generic handlers remain for dictation and repair links.
ipcMain.handle("perm:status", () => ({
  mic: process.platform === "darwin" ? systemPreferences.getMediaAccessStatus?.("microphone") ?? "unknown" : "unavailable",
}));
ipcMain.handle("perm:request-mic", async () => {
  if (process.platform !== "darwin") return false;
  try {
    return await systemPreferences.askForMediaAccess("microphone");
  } catch {
    return false;
  }
});

// macOS never re-prompts a denied permission — the only path is System
// Settings; deep-link straight to the right privacy pane.
ipcMain.handle("perm:open-settings", (_event, pane) => {
  if (process.platform === "win32") {
    const targets = { mic: "ms-settings:privacy-microphone", screen: "ms-settings:privacy-screenshots", speech: "ms-settings:privacy-speech" };
    return shell.openExternal(Object.hasOwn(targets, pane) ? targets[pane] : "ms-settings:privacy");
  }
  if (process.platform !== "darwin") return false;
  const panes = {
    mic: "Privacy_Microphone",
    screen: "Privacy_ScreenCapture",
    speech: "Privacy_SpeechRecognition",
  };
  const target = Object.hasOwn(panes, pane) ? panes[pane] : "Privacy";
  return shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${target}`);
});

ipcMain.handle("speech:start", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) startSpeech(win);
});
ipcMain.handle("speech:stop", () => stopSpeech());

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock.setIcon(APP_ICON);
  // getDisplayMedia stays in the app responsibility chain. Local computer
  // onboarding uses the CUA SDK gate; this handler does not start the driver.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
  registerCuaIpc();
  // Resolve the fail-closed CUA state before the packaged harness reads its
  // descriptor. If TCC is incomplete this records needs-permissions and does
  // not create or start the embedded daemon.
  performanceRecorder.markMain("cumea:main:cua-start");
  await startCua().catch((e) => console.error("[cua] start failed:", e));
  performanceRecorder.markMain("cumea:main:cua-settled");
  if (app.isPackaged) {
    performanceRecorder.markMain("cumea:main:server-start");
    serverReady = await startServerPackaged();
    performanceRecorder.markMain(
      serverReady ? "cumea:main:server-ready" : "cumea:main:server-failed",
    );
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// EMBEDDING.md lifecycle rule: defer the first quit until the embedded
// daemon's async cleanup completes — it can't run after the host exits.
let quitCleanupStarted = false;
let quitCleanupDone = false;
app.on("before-quit", (e) => {
  performanceRecorder.markMain("cumea:main:before-quit");
  performanceRecorder.flush();
  if (quitCleanupDone) return;
  e.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  try {
    serverProc?.kill();
  } catch {}
  stopSpeech();
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(resolve, 2500);
    timer.unref?.();
  });
  Promise.race([
    stopCua().catch((error) => console.error("[cua] stop failed:", error)),
    timeout,
  ]).finally(() => {
    quitCleanupDone = true;
    performanceRecorder.flush();
    app.quit();
  });
});
