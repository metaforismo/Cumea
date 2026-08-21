import { describe, expect, it } from "vitest";

import { HTML_ARTIFACT_CSP, HTML_ARTIFACT_PERMISSIONS_POLICY } from "./html-artifact-policy.ts";

describe("HTML artifact response policy", () => {
  it("denies executable, network, navigation, form, and nested browsing capabilities", () => {
    for (const directive of [
      "default-src 'none'",
      "script-src 'none'",
      "connect-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "navigate-to 'none'",
      "sandbox",
    ]) expect(HTML_ARTIFACT_CSP).toContain(directive);
    expect(HTML_ARTIFACT_CSP).toContain("frame-ancestors 'self'");
    expect(HTML_ARTIFACT_CSP).not.toContain("'unsafe-eval'");
    expect(HTML_ARTIFACT_CSP).not.toContain("https:");
    expect(HTML_ARTIFACT_CSP).not.toContain("http:");
  });

  it("does not delegate ambient device or clipboard permissions", () => {
    for (const feature of ["camera=()", "clipboard-read=()", "clipboard-write=()", "geolocation=()", "microphone=()", "payment=()", "usb=()"] ) {
      expect(HTML_ARTIFACT_PERMISSIONS_POLICY).toContain(feature);
    }
  });
});
