import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FileViewer, parseStructuredFilePreview, type FileCapabilityView } from "./FileViewer";

const file = (kind: FileCapabilityView["kind"]): FileCapabilityView => ({
  token: "A".repeat(43),
  name: `report.${kind === "markdown" ? "md" : kind === "binary" ? "bin" : kind}`,
  mime: kind === "pdf" ? "application/pdf" : "application/octet-stream",
  kind,
  size: 1024,
  source: "local",
  expiresAt: Date.now() + 60_000,
});

describe("FileViewer", () => {
  it("keeps PDF and unknown binaries download-only until the PDF.js gate lands", () => {
    for (const kind of ["pdf", "binary"] as const) {
      const markup = renderToStaticMarkup(createElement(FileViewer, { file: file(kind), onClose: () => {} }));
      expect(markup).toContain(`/api/files/${"A".repeat(43)}/download`);
      expect(markup).toContain("Preview not available yet");
      expect(markup).not.toContain("<iframe");
      expect(markup).not.toContain("<embed");
      expect(markup).not.toContain("<object");
      expect(markup).not.toContain("file://");
    }
  });

  it("validates renderer preview payloads and rejects oversized or malformed projections", () => {
    expect(parseStructuredFilePreview({ kind: "markdown", text: "# Safe" })).toEqual({ kind: "markdown", text: "# Safe" });
    expect(parseStructuredFilePreview({
      kind: "document",
      blocks: [{ type: "heading", level: 1, text: "Title" }, { type: "paragraph", text: "Body" }],
      truncated: false,
      warnings: [],
    })).toEqual({
      kind: "document",
      blocks: [{ type: "heading", level: 1, text: "Title" }, { type: "paragraph", text: "Body" }],
      truncated: false,
      warnings: [],
    });

    expect(() => parseStructuredFilePreview({ kind: "document", blocks: [{ type: "script", text: "x" }], truncated: false, warnings: [] })).toThrow("invalid file preview");
    expect(() => parseStructuredFilePreview({ kind: "document", blocks: [], truncated: "no", warnings: [] })).toThrow("invalid file preview");
    expect(() => parseStructuredFilePreview({ kind: "markdown", text: "x".repeat(5 * 1024 * 1024 + 1) })).toThrow("invalid file preview");
  });

  it("exposes a modal dialog and constructs capability URLs only from the opaque token", () => {
    const markup = renderToStaticMarkup(createElement(FileViewer, { file: file("docx"), onClose: () => {} }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain(`/api/files/${"A".repeat(43)}/download`);
    expect(markup).not.toContain("/Users/");
    expect(markup).not.toContain("C:\\");
  });
});
