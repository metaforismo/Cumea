import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  safeStorage,
  session,
  shell,
  systemPreferences,
  utilityProcess,
} from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  disableCuaForPerformance,
  publicCuaStatus,
  startCua,
  stopCua,
  registerCuaIpc,
} from "./cua.mjs";
import { createDesktopCredentialController } from "./desktop-credentials.mjs";
import { startSpeech, stopSpeech } from "./speech.mjs";
import { createPerformanceRecorder } from "./performance.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 127.0.0.1 explicitly — vite binds IPv4; a bare "localhost" here can
// resolve to ::1 and paint a black window
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://127.0.0.1:5199";
let SERVER_PORT = 8799;
const APP_ICON = path.join(__dirname, "resources/app-icon.png");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MANAGED_SECRET_ENV = [
  "BOX_TOKEN",
  "COMPOSIO_API_KEY",
  "COMPOSIO_KEY",
  "XAI_API_KEY",
];

const performanceOutputFile = process.env.CUMEA_PERFORMANCE_FILE?.trim() ?? "";
const performanceEnabled = Boolean(performanceOutputFile);
const performanceProfile =
  performanceEnabled && process.env.CUMEA_PERFORMANCE_PROFILE === "first-run"
    ? "first-run"
    : "returning";
const performanceCacheTreatment = performanceEnabled
  ? ["fresh-profile", "warm", "chromium-cold"].includes(
      process.env.CUMEA_PERFORMANCE_CACHE_TREATMENT,
    )
    ? process.env.CUMEA_PERFORMANCE_CACHE_TREATMENT
    : performanceProfile === "first-run"
      ? "fresh-profile"
      : "warm"
  : undefined;
const performanceRuntime =
  performanceEnabled && process.env.CUMEA_PERFORMANCE_RUNTIME === "real" ? "real" : "fixture";
const performanceUserData = performanceEnabled
  ? process.env.CUMEA_PERFORMANCE_USER_DATA?.trim() ?? ""
  : "";
const performanceClearCache =
  performanceEnabled && process.env.CUMEA_PERFORMANCE_CLEAR_CACHE === "1";
const performanceClearCacheOnly =
  performanceClearCache && process.env.CUMEA_PERFORMANCE_CLEAR_CACHE_ONLY === "1";
const performanceSkipCua =
  performanceEnabled && process.env.CUMEA_PERFORMANCE_SKIP_CUA === "1";
const performanceAutoQuitMark =
  performanceProfile === "first-run"
    ? "cumea:renderer:onboarding-painted"
    : "cumea:renderer:shell-usable-painted";

if (performanceUserData) {
  const root = path.resolve(performanceUserData);
  const isolatedPaths = {
    userData: root,
    sessionData: path.join(root, "session"),
    logs: path.join(root, "logs"),
    crashDumps: path.join(root, "crash-dumps"),
  };
  for (const target of Object.values(isolatedPaths)) {
    mkdirSync(target, { recursive: true, mode: 0o700 });
  }
  for (const [name, target] of Object.entries(isolatedPaths)) app.setPath(name, target);
}

const performanceRecorder = createPerformanceRecorder({
  outputFile: performanceOutputFile,
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
    ...(performanceEnabled
      ? {
          profile: performanceProfile,
          cacheTreatment: performanceCacheTreatment,
          runtime: performanceRuntime,
        }
      : {}),
    ...(process.env.CUMEA_PERFORMANCE_MACHINE_FINGERPRINT
      ? {
          machineFingerprint: process.env.CUMEA_PERFORMANCE_MACHINE_FINGERPRINT.slice(0, 80),
        }
      : {}),
    ...(process.env.CUMEA_PERFORMANCE_MACHINE_LABEL
      ? { machineLabel: process.env.CUMEA_PERFORMANCE_MACHINE_LABEL.slice(0, 120) }
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
  if (!recorded || payload?.name !== performanceAutoQuitMark) return;
  performanceRecorder.flush();
  if (performanceOutputFile && process.env.CUMEA_PERFORMANCE_AUTO_QUIT === "1") {
    setImmediate(() => app.quit());
  }
});

function isSafeExternalUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

function trustedRenderer(event) {
  const expected = app.isPackaged
    ? `http://127.0.0.1:${SERVER_PORT}`
    : new URL(DEV_URL).origin;
  try {
    return new URL(event.senderFrame.url).origin === expected;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let desktopCredentials = null;
let serverProc = null;
let serverReady = true;

function serverEnvironment() {
  const environment = { ...process.env };
  // A packaged desktop host never lets the harness inherit ambient provider
  // secrets. OS-vault values are injected through dedicated one-boot fields;
  // blocked mode injects only the managed marker, quarantining recoverable
  // legacy plaintext instead of silently falling back to it.
  if (app.isPackaged) {
    for (const name of MANAGED_SECRET_ENV) delete environment[name];
  }
  return {
    ...environment,
    ...desktopCredentials?.serverEnvironment(),
    CUMEA_STATIC_DIR: path.join(process.resourcesPath, "ui"),
    CUMEA_PORT: String(SERVER_PORT),
    CUMEA_CUA_CONNECTION: path.join(app.getPath("userData"), "cua-connection.json"),
  };
}

// Packaged: the harness server ships in Resources (compiled JS, zero deps)
// and runs on Electron's own Node via utilityProcess. It serves the built
// UI too, so the window talks to one origin and there is no dev proxy.
async function startServerOn(port) {
  const entry = path.join(process.resourcesPath, "server", "index.js");
  SERVER_PORT = port;
  const proc = utilityProcess.fork(entry, [], {
    env: serverEnvironment(),
    stdio: "inherit",
  });
  let exited = false;
  proc.once("exit", () => {
    exited = true;
    if (serverProc === proc) serverProc = null;
  });
  // Wait for the port to answer. Identity is verified by the exact child PID,
  // not by accepting any process that happens to expose a similar endpoint.
  for (let i = 0; i < 40; i++) {
    if (exited) return null;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.app === "cumea" && body.pid === proc.pid && body.static) return proc;
        break;
      }
    } catch {
      /* not up yet */
    }
    await delay(500);
  }
  try {
    proc.kill();
  } catch {}
  return null;
}

async function startServerPackaged() {
  // Two passes cover a quit-and-reopen race with a dying previous instance.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const port of [8799, 18799, 28799]) {
      const proc = await startServerOn(port);
      if (proc) {
        serverProc = proc;
        SERVER_PORT = port;
        return true;
      }
    }
    await delay(2500);
  }
  return false;
}

async function stopServerProcess() {
  const current = serverProc;
  serverProc = null;
  if (!current) return;
  await Promise.race([
    new Promise((resolve) => {
      current.once("exit", resolve);
      try {
        current.kill();
      } catch {
        resolve();
      }
    }),
    delay(3000),
  ]);
}

async function restartServerForCredentials() {
  if (!app.isPackaged) {
    throw new Error("secure credential updates require the packaged desktop host");
  }
  const port = SERVER_PORT;
  await stopServerProcess();
  await delay(100);
  const proc = await startServerOn(port);
  if (!proc) {
    serverReady = false;
    throw new Error("the agent host could not restart on its existing port");
  }
  serverProc = proc;
  serverReady = true;
  const response = await fetch(`http://127.0.0.1:${port}/api/config`);
  if (!response.ok) throw new Error("the restarted agent host did not return configuration status");
  return response.json();
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
    const allowedOrigin = app.isPackaged
      ? `http://127.0.0.1:${SERVER_PORT}`
      : new URL(DEV_URL).origin;
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
ipcMain.handle("perm:status", () => ({
  mic:
    process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus?.("microphone") ?? "unknown"
      : "unavailable",
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
    const targets = {
      mic: "ms-settings:privacy-microphone",
      screen: "ms-settings:privacy-screenshots",
      speech: "ms-settings:privacy-speech",
    };
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

ipcMain.handle("credentials:status", (event) => {
  if (!trustedRenderer(event)) throw new Error("credential status is unavailable to this page");
  return desktopCredentials?.publicStatus();
});
ipcMain.handle("credentials:set", async (event, payload) => {
  if (!trustedRenderer(event)) throw new Error("credential updates are unavailable to this page");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("credential update is invalid");
  }
  const config = await desktopCredentials.update(
    payload.section,
    payload.value,
    restartServerForCredentials,
  );
  return { storage: desktopCredentials.publicStatus(), config };
});

app.whenReady().then(async () => {
  if (performanceClearCache) {
    performanceRecorder.markMain("cumea:main:cache-clear-start");
    await Promise.all([
      session.defaultSession.clearCache(),
      session.defaultSession.clearCodeCaches({}),
    ]);
    performanceRecorder.markMain("cumea:main:cache-clear-settled");
    performanceRecorder.flush();
    if (performanceClearCacheOnly) {
      app.quit();
      return;
    }
  }

  desktopCredentials = createDesktopCredentialController({
    app,
    safeStorage,
    performanceFixture: performanceEnabled && performanceRuntime === "fixture",
  });
  const credentialStatus = await desktopCredentials.initialize();
  // Non-secret mode only. The preload uses this to prevent a packaged app
  // from silently falling back to plaintext writes when the OS store fails.
  process.env.CUMEA_DESKTOP_CREDENTIAL_STORAGE_MODE = credentialStatus.mode;

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
  // descriptor. Deterministic fixture runs bypass the SDK and native daemon;
  // normal and explicit real-runtime runs retain the production path.
  performanceRecorder.markMain("cumea:main:cua-start");
  if (performanceSkipCua) {
    disableCuaForPerformance();
  } else {
    await startCua().catch((error) => console.error("[cua] start failed:", error));
  }
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

// Defer the first quit until embedded native/server cleanup completes.
let quitCleanupStarted = false;
let quitCleanupDone = false;
app.on("before-quit", (event) => {
  performanceRecorder.markMain("cumea:main:before-quit");
  performanceRecorder.flush();
  if (quitCleanupDone) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  stopSpeech();
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    timer.unref?.();
  });
  Promise.race([
    Promise.allSettled([
      stopServerProcess(),
      stopCua().catch((error) => console.error("[cua] stop failed:", error)),
    ]),
    timeout,
  ]).finally(() => {
    quitCleanupDone = true;
    performanceRecorder.flush();
    app.quit();
  });
});
