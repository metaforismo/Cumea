// Renderer bridge. contextIsolation stays on; the renderer only ever sees
// this narrow surface (window.cumea), never Node or ipcRenderer itself.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cumea", {
  platform: process.platform,
  /** Opt-in local performance marks. Rebuild the payload here so a compromised
   * renderer cannot attach unrelated data; main still validates the exact
   * mark allowlist and finite clocks. */
  performanceMark: (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    ipcRenderer.send("performance:renderer-mark", {
      name: payload.name,
      timeOrigin: payload.timeOrigin,
      startTime: payload.startTime,
    });
  },
  /** Public local-computer state. Socket paths and MCP launch details stay in main. */
  cuaStatus: () => ipcRenderer.invoke("cua:status"),
  /** User-initiated TCC prompt/check. Starts or restarts only after both grants. */
  cuaRequestPermissions: () => ipcRenderer.invoke("cua:request-permissions"),
  /** Explicit read/check/reconnect path after returning from System Settings. */
  cuaRetry: () => ipcRenderer.invoke("cua:retry"),
  cuaOpenSettings: (permission) => ipcRenderer.invoke("cua:open-settings", permission),
  /** One frame of this Mac's screen as a data: URL (Screen Recording TCC). */
  screenFrame: () => ipcRenderer.invoke("screen:frame"),
  speechStart: () => ipcRenderer.invoke("speech:start"),
  speechStop: () => ipcRenderer.invoke("speech:stop"),
  onSpeechTranscript: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on("speech:transcript", handler);
    return () => ipcRenderer.removeListener("speech:transcript", handler);
  },
  onSpeechEnd: (cb) => {
    const handler = (_event, info) => cb(info);
    ipcRenderer.on("speech:end", handler);
    return () => ipcRenderer.removeListener("speech:end", handler);
  },
  /** {mic} TCC status strings: granted|denied|not-determined|unknown.
   * No screen field — macOS 15+ caches that status per-process, so any
   * value here would lie for the whole session after a grant. */
  permStatus: () => ipcRenderer.invoke("perm:status"),
  /** Triggers the macOS microphone prompt; resolves true when granted. */
  permRequestMic: () => ipcRenderer.invoke("perm:request-mic"),
  /** Opens System Settings on the given privacy pane: mic|screen|speech. */
  permOpenSettings: (pane) => ipcRenderer.invoke("perm:open-settings", pane),
});
