// CUA computer-use wiring owned by the Electron main process.
//
// The embedded daemon is never started until the official SDK reports that
// this host has both Accessibility and Screen Recording grants. The renderer
// receives only a public status object; the generation-scoped MCP descriptor
// is persisted for the local harness server.

import { app, ipcMain, shell } from "electron";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { normalizeCuaPermissions, toPublicCuaStatus } from "./cua-contract.mjs";

const INSTALLED_DRIVER = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const STANDALONE_SOCKET = path.join(app.getPath("home"), "Library/Caches/cua-driver/cua-driver.sock");
const HOST_BUNDLE_ID = "io.github.metaforismo.cumea";

let embeddedHost = null;
let connection = null;
let activeGeneration = null;
let transition = Promise.resolve();
let performanceDisabled = false;

function connectionPath() {
  // app.setPath("userData", …) is applied by the benchmark entry after static
  // imports have evaluated. Resolve lazily so an isolated run can never write
  // its descriptor into the developer's normal Cumea profile.
  return path.join(app.getPath("userData"), "cua-connection.json");
}

function persistConnection(value) {
  const target = connectionPath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function setConnection(value) {
  connection = value;
  persistConnection(value);
  return publicCuaStatus();
}

function queueTransition(work) {
  const next = transition.catch(() => undefined).then(work);
  transition = next.catch(() => undefined);
  return next;
}

export function resolveDriverBinary() {
  if (process.env.CUA_DRIVER_PATH) return process.env.CUA_DRIVER_PATH;
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "cua-driver");
    if (fs.existsSync(bundled)) return bundled;
  }
  if (fs.existsSync(INSTALLED_DRIVER)) return INSTALLED_DRIVER;
  return null;
}

function socketAlive(socketPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(socketPath)) return resolve(false);
    const socket = net.createConnection(socketPath);
    let settled = false;
    const done = (alive) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), 1500).unref();
  });
}

async function permissionApi() {
  const [sdk, electronSdk] = await Promise.all([
    import("@trycua/cua-driver"),
    import("@trycua/cua-driver/electron"),
  ]);
  return {
    current: sdk.currentMacOsPermissionStatus,
    request: electronSdk.requestMacOSPermissions,
    hasRequired: electronSdk.hasRequiredMacOSPermissions,
    openScreenSettings: electronSdk.openMacOSScreenRecordingSettings,
  };
}

async function readHostPermissions({ request = false } = {}) {
  if (process.platform !== "darwin") return normalizeCuaPermissions(null);
  const api = await permissionApi();
  const status = request ? api.request() : api.current();
  return { ...normalizeCuaPermissions(status), required: api.hasRequired(status) };
}

function embeddedDescriptor(binary, driverConnection) {
  const environment = Object.fromEntries(
    (driverConnection.mcp?.environment ?? []).map(({ name, value }) => [name, value]),
  );
  return {
    mode: "embedded",
    state: "ready",
    permissions: { accessibility: true, screenRecording: true },
    generation: driverConnection.generation,
    driverVersion: driverConnection.driverVersion,
    socketPath: driverConnection.socketPath,
    mcpCommand: driverConnection.mcp?.command || binary,
    mcpArgs: driverConnection.mcp?.args ?? ["mcp", "--embedded", "--socket", driverConnection.socketPath],
    mcpEnv: {
      CUA_DRIVER_EMBEDDED: "1",
      CUA_DRIVER_HOST_BUNDLE_ID: HOST_BUNDLE_ID,
      ...environment,
    },
  };
}

function observeExit(host, generation) {
  void host
    .waitForExit(generation)
    .then((result) => {
      if (activeGeneration !== generation) return;
      activeGeneration = null;
      setConnection({
        mode: "error",
        state: "error",
        reason: result.success
          ? "local computer host stopped unexpectedly"
          : `local computer host exited${result.code == null ? "" : ` with code ${result.code}`}`,
      });
    })
    .catch((error) => {
      if (activeGeneration !== generation) return;
      activeGeneration = null;
      setConnection({ mode: "error", state: "error", reason: `local computer host failed: ${error?.message ?? error}` });
    });
}

async function startOrRestartEmbedded(binary, { restart = false } = {}) {
  const { EmbeddedCuaDriverHost } = await import("@trycua/cua-driver/embedded");
  if (!embeddedHost) embeddedHost = new EmbeddedCuaDriverHost(binary, HOST_BUNDLE_ID);
  if (!restart && activeGeneration && connection?.state === "ready") return publicCuaStatus();
  setConnection({ mode: "embedded", state: "starting", permissions: { accessibility: true, screenRecording: true } });
  const next = restart && activeGeneration ? await embeddedHost.restart() : await embeddedHost.start();
  activeGeneration = next.generation;
  const descriptor = embeddedDescriptor(binary, next);
  setConnection(descriptor);
  observeExit(embeddedHost, next.generation);
  return publicCuaStatus();
}

async function stopEmbedded() {
  const host = embeddedHost;
  activeGeneration = null;
  if (!host) return;
  embeddedHost = null;
  try {
    await host.stop();
  } finally {
    host.uniffiDestroy?.();
  }
}

async function reconcileEmbedded(binary, { request = false, restart = false } = {}) {
  let permissions;
  try {
    permissions = await readHostPermissions({ request });
  } catch (error) {
    await stopEmbedded().catch(() => undefined);
    return setConnection({
      mode: "error",
      state: "error",
      reason: `could not read local computer permissions: ${error?.message ?? error}`,
    });
  }

  if (!permissions.required) {
    await stopEmbedded().catch(() => undefined);
    return setConnection({
      mode: "needs-permissions",
      state: "needs-permissions",
      permissions: normalizeCuaPermissions(permissions),
      reason: "Accessibility and Screen Recording are required before local computer control can start",
    });
  }

  try {
    return await startOrRestartEmbedded(binary, { restart });
  } catch (error) {
    await stopEmbedded().catch(() => undefined);
    return setConnection({ mode: "error", state: "error", reason: `embedded host failed: ${error?.message ?? error}` });
  }
}

async function reconcileCua(options = {}) {
  if (performanceDisabled) {
    await stopEmbedded().catch(() => undefined);
    return setConnection({
      mode: "unavailable",
      state: "unavailable",
      reason: "local computer control is disabled in the deterministic performance fixture",
    });
  }

  if (process.platform !== "darwin") {
    await stopEmbedded().catch(() => undefined);
    return setConnection({
      mode: "unavailable",
      state: "unavailable",
      reason: "local computer control is currently available on macOS only; cloud computers remain available",
    });
  }

  const binary = resolveDriverBinary();
  if (!binary) {
    await stopEmbedded().catch(() => undefined);
    return setConnection({ mode: "unavailable", state: "unavailable", reason: "cua-driver binary not found" });
  }

  const embedded = app.isPackaged || process.env.CUMEA_CUA_EMBEDDED === "1";
  if (embedded) return reconcileEmbedded(binary, options);

  await stopEmbedded().catch(() => undefined);
  if (await socketAlive(STANDALONE_SOCKET)) {
    return setConnection({
      mode: "standalone",
      state: "ready",
      socketPath: STANDALONE_SOCKET,
      mcpCommand: binary,
      mcpArgs: ["mcp"],
      mcpEnv: {},
    });
  }
  return setConnection({
    mode: "unavailable",
    state: "unavailable",
    reason: "the standalone CuaDriver daemon is not running on this development Mac",
  });
}

export function publicCuaStatus() {
  return toPublicCuaStatus(connection);
}

export function disableCuaForPerformance() {
  performanceDisabled = true;
  return setConnection({
    mode: "unavailable",
    state: "unavailable",
    reason: "local computer control is disabled in the deterministic performance fixture",
  });
}

export function startCua() {
  return queueTransition(() => reconcileCua());
}

export function checkCua() {
  return queueTransition(() => reconcileCua());
}

export function retryCua() {
  return queueTransition(() => reconcileCua({ restart: true }));
}

export function requestCuaPermissions() {
  return queueTransition(() => reconcileCua({ request: true, restart: true }));
}

export async function openCuaPermissionSettings(permission) {
  if (process.platform !== "darwin") return false;
  if (permission === "screenRecording") {
    const api = await permissionApi();
    await api.openScreenSettings();
    return true;
  }
  if (permission === "accessibility") {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
    return true;
  }
  return false;
}

export function stopCua() {
  return queueTransition(async () => {
    await stopEmbedded().catch(() => undefined);
    return setConnection({ mode: "unavailable", state: "unavailable", reason: "Cumea is shutting down" });
  });
}

export function registerCuaIpc() {
  ipcMain.handle("cua:status", () => checkCua());
  ipcMain.handle("cua:request-permissions", () => requestCuaPermissions());
  ipcMain.handle("cua:retry", () => retryCua());
  ipcMain.handle("cua:open-settings", (_event, permission) => openCuaPermissionSettings(permission));
}
