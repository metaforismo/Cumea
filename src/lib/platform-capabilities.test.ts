import { describe, expect, it } from "vitest";

import { capabilitiesFor } from "./platform-capabilities";

describe("capabilitiesFor", () => {
  it("enables native dictation and local computer use only on macOS", () => {
    expect(capabilitiesFor("darwin", true)).toEqual({
      platform: "darwin",
      desktop: true,
      nativeDictation: true,
      localComputer: true,
    });
  });

  it("keeps native capabilities off on Windows and Linux until proven", () => {
    for (const platform of ["win32", "linux"]) {
      const caps = capabilitiesFor(platform, true);
      expect(caps).toMatchObject({ platform, desktop: true, nativeDictation: false, localComputer: false });
    }
  });

  it("fails closed on an absent Electron bridge", () => {
    expect(capabilitiesFor("darwin", false)).toEqual({
      platform: "unknown",
      desktop: false,
      nativeDictation: false,
      localComputer: false,
    });
  });

  it("fails closed on unknown or missing platforms", () => {
    for (const platform of [undefined, null, "", "sunos", "darwin ", "Darwin"]) {
      expect(capabilitiesFor(platform, true).platform).toBe("unknown");
      expect(capabilitiesFor(platform, true).nativeDictation).toBe(false);
      expect(capabilitiesFor(platform, true).localComputer).toBe(false);
    }
  });
});
