// The narrow bridge the Electron preload exposes. Absent in the browser.
import type { SpeechEndReason } from "@/lib/speech";

export {};

declare global {
  type CuaPublicStatus = {
    state: "checking" | "starting" | "ready" | "needs-permissions" | "unavailable" | "error";
    mode: "embedded" | "standalone" | "needs-permissions" | "unavailable" | "error" | null;
    permissions: { accessibility: boolean; screenRecording: boolean } | null;
    reason: string | null;
    driverVersion: string | null;
  };

  type DesktopCredentialSection = "xai" | "composio" | "composioApi" | "box";
  type DesktopCredentialStorageStatus = {
    mode: "os" | "blocked" | "file" | "performance-fixture";
    managed: boolean;
    available: boolean;
    secure: boolean;
    backend: string | null;
    reason: string | null;
    migrated: boolean;
    legacyPresent: boolean;
    configured: Record<DesktopCredentialSection, boolean>;
  };

  interface Window {
    cumea?: {
      platform: "darwin" | "win32" | "linux" | string;
      credentialStorageMode: DesktopCredentialStorageStatus["mode"];
      credentialsStatus(): Promise<DesktopCredentialStorageStatus>;
      credentialSet(payload: {
        section: DesktopCredentialSection;
        value: string | null;
      }): Promise<{
        storage: DesktopCredentialStorageStatus;
        config: {
          xai?: { configured: boolean };
          composio: { configured: boolean; apiKeyConfigured?: boolean };
          box: { configured: boolean };
          profile?: { name: string; email: string };
        };
      }>;
      performanceScenario?: {
        profile: "first-run" | "returning";
        seedOnboarding: boolean;
      };
      performanceMark(payload: {
        name: string;
        timeOrigin: number;
        startTime: number;
      }): void;
      cuaStatus(): Promise<CuaPublicStatus>;
      cuaRequestPermissions(): Promise<CuaPublicStatus>;
      cuaRetry(): Promise<CuaPublicStatus>;
      cuaOpenSettings(permission: "accessibility" | "screenRecording"): Promise<boolean>;
      screenFrame(): Promise<string | null>;
      speechStart(): Promise<void>;
      speechStop(): Promise<{ stopped: boolean }>;
      onSpeechTranscript(
        cb: (line: { partial: boolean; text: string }) => void,
      ): () => void;
      onSpeechEnd(
        cb: (info: { code: number | null; reason?: SpeechEndReason }) => void,
      ): () => void;
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
