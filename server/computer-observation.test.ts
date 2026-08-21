import { describe, expect, it } from "vitest";
import {
  normalizeBrowserUrl,
  ObservationCoordinator,
  parseBrowserTargets,
  safeBrowserUrl,
} from "./computer-observation.ts";

describe("computer observation policy", () => {
  it("does not resend byte-identical frames and records bounded metrics", () => {
    const observations = new ObservationCoordinator();
    expect(observations.observeFrame("frame-a").changed).toBe(true);
    observations.noteAction(2);
    expect(observations.observeFrame("frame-a").changed).toBe(false);
    expect(observations.observeFrame("frame-b").changed).toBe(true);
    observations.noteRetry();
    observations.noteStructuredObservation();
    observations.noteVerification(true);
    observations.noteVerification(false);
    expect(observations.metrics).toEqual({
      screenshotsCaptured: 3,
      screenshotsSentToModel: 2,
      structuredBrowserObservations: 1,
      computerActions: 2,
      retries: 1,
      verificationSuccesses: 1,
      verificationFailures: 1,
    });
  });

  it("redacts credentials and model-visible navigation secrets", () => {
    const raw = "https://user:password@example.com/a?token=secret#fragment";
    expect(normalizeBrowserUrl(raw)).toBe("https://example.com/a?token=secret#fragment");
    expect(safeBrowserUrl(raw)).toBe("https://example.com/a");
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeNull();
    expect(parseBrowserTargets(JSON.stringify([
      { id: "one", type: "page", title: " Example   page ", url: raw },
      { id: "two", type: "service_worker", url: "https://example.com/worker" },
    ]))).toEqual([{
      id: "one",
      title: "Example page",
      url: "https://example.com/a",
      comparisonUrl: "https://example.com/a?token=secret#fragment",
    }]);
  });

  it("rejects oversized or malformed DevTools responses", () => {
    expect(parseBrowserTargets("not json")).toEqual([]);
    expect(parseBrowserTargets("x".repeat(1_000_001))).toEqual([]);
  });
});
