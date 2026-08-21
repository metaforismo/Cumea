/** One static snapshot of what this build can do on this OS. Everything is
 * fail-closed: an unknown platform, a missing Electron bridge, or a plain
 * browser tab yields a snapshot with every native capability off, so the UI
 * can never promise dictation or local computer use the host cannot deliver.
 * Live state (TCC grants, CUA connection, credential backend) stays reported
 * by the bridge at runtime — this snapshot only answers "is this capability
 * even possible here". */

export type PlatformId = "darwin" | "win32" | "linux" | "unknown";

export interface PlatformCapabilities {
  platform: PlatformId;
  /** Running inside the Electron shell (vs a plain browser tab). */
  desktop: boolean;
  /** On-device speech dictation via the macOS speech helper. */
  nativeDictation: boolean;
  /** Local computer use via the CUA driver (macOS only today). */
  localComputer: boolean;
}

const KNOWN_PLATFORMS: readonly string[] = ["darwin", "win32", "linux"];

const CLOSED: PlatformCapabilities = { platform: "unknown", desktop: false, nativeDictation: false, localComputer: false };

export function capabilitiesFor(platform: string | null | undefined, desktop: boolean): PlatformCapabilities {
  if (!desktop || typeof platform !== "string" || !KNOWN_PLATFORMS.includes(platform)) return CLOSED;
  const id = platform as Exclude<PlatformId, "unknown">;
  return {
    platform: id,
    desktop: true,
    nativeDictation: id === "darwin",
    localComputer: id === "darwin",
  };
}

export function currentPlatformCapabilities(): PlatformCapabilities {
  const bridge = typeof window !== "undefined" ? window.cumea : undefined;
  return capabilitiesFor(bridge?.platform, Boolean(bridge));
}
