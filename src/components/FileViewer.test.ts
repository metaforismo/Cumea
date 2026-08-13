import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FileViewer, type FileCapabilityView } from "./FileViewer";
import { pdfCapabilityPreviewUrl } from "./PdfViewer";

describe("PDF viewer browser policy", () => {
  it("uses the integrated renderer instead of an iframe or browser plugin", () => {
    const file: FileCapabilityView = {
      token: "A".repeat(43),
      name: "paper.pdf",
      mime: "application/pdf",
      kind: "pdf",
      size: 1024,
      source: "local",
      expiresAt: Date.now() + 60_000,
    };

    const markup = renderToStaticMarkup(createElement(FileViewer, { file, onClose: () => {} }));

    expect(pdfCapabilityPreviewUrl(file.token)).toBe(`/api/files/${file.token}/preview`);
    expect(markup).toContain("Preparing safe PDF preview");
    expect(markup).not.toContain("<iframe");
    expect(markup).not.toContain("<embed");
    expect(markup).not.toContain("<object");
    expect(markup).not.toContain("file://");
  });
});
