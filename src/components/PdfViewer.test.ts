import { describe, expect, it } from "vitest";

import { boundedCanvasPlan, extractPageText, pdfCapabilityPreviewUrl } from "./PdfViewer";

describe("safe PDF.js viewer helpers", () => {
  it("constructs only an opaque same-origin capability endpoint", () => {
    const token = "A".repeat(43);
    expect(pdfCapabilityPreviewUrl(token)).toBe(`/api/files/${token}/preview`);
    for (const invalid of ["", "../paper.pdf", "https://example.com/paper.pdf", "A".repeat(42), `${"A".repeat(43)}/x`]) {
      expect(() => pdfCapabilityPreviewUrl(invalid)).toThrow(/invalid/i);
    }
  });

  it("caps device scale and rejects unsafe page dimensions", () => {
    expect(boundedCanvasPlan(612, 792, 4)).toMatchObject({
      cssWidth: 612,
      cssHeight: 792,
      pixelWidth: 1224,
      pixelHeight: 1584,
      outputScale: 2,
    });
    const square = boundedCanvasPlan(4096, 4096, 2);
    expect(square.pixelWidth * square.pixelHeight).toBeLessThanOrEqual(16_777_216);
    expect(() => boundedCanvasPlan(4097, 100, 1)).toThrow(/too large/i);
    expect(() => boundedCanvasPlan(Number.NaN, 100, 1)).toThrow(/invalid dimensions/i);
  });

  it("produces a bounded, line-aware text alternative", () => {
    expect(extractPageText([
      { str: "Hello", hasEOL: false },
      { str: "world", hasEOL: true },
      { str: "Next line", hasEOL: false },
      { str: undefined, hasEOL: undefined },
    ])).toEqual({ text: "Hello world\nNext line", truncated: false });

    const oversized = extractPageText([{ str: "x".repeat(100_001), hasEOL: false }]);
    expect(oversized.text).toHaveLength(100_000);
    expect(oversized.truncated).toBe(true);
  });
});
