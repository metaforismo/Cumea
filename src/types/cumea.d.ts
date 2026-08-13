// The narrow bridge the Electron preload exposes. Absent in the browser.
export {};

declare global {
  type CuaPublicStatus = {
    state: "checking" | "starting" | "ready" | "needs-permissions" | "unavailable" | "error";
    mode: "embedded" | "standalone" | "needs-permissions" | "unavailable" | "error" | null;
    permissions: { accessibility: boolean; screenRecording: boolean } | null;
    reason: string | null;
    driverVersion: string | null;
  };

  interface Window {
    cumea?: {
      platform: "darwin" | "win32" | "linux" | string;
      cuaStatus(): Promise<CuaPublicStatus>;
      cuaRequestPermissions(): Promise<CuaPublicStatus>;
      cuaRetry(): Promise<CuaPublicStatus>;
      cuaOpenSettings(permission: "accessibility" | "screenRecording"): Promise<boolean>;
      screenFrame(): Promise<string | null>;
      speechStart(): Promise<void>;
      speechStop(): Promise<void>;
      onSpeechTranscript(
        cb: (line: { partial?: boolean; text?: string; error?: string }) => void,
      ): () => void;
      onSpeechEnd(cb: (info: { code: number | null }) => void): () => void;
      /** {mic} TCC status: granted|denied|not-determined|unknown. Screen
       * status is deliberately absent — macOS 15+ caches it per-process,
       * so it lies for the whole session after a grant. */
      permStatus(): Promise<{ mic: string }>;
      /** Triggers the macOS microphone prompt; resolves true when granted. */
      permRequestMic(): Promise<boolean>;
      /** Opens System Settings on a privacy pane: mic|screen|speech. */
      permOpenSettings(pane: "mic" | "screen" | "speech"): Promise<void>;
    };
  }
}
