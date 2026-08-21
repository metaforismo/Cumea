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

describe("HTML artifact browser policy", () => {
  it("uses an opaque, non-interactive sandbox without an HTML injection sink", () => {
    const file: FileCapabilityView = {
      token: "B".repeat(43),
      name: 'artifact"><script>alert(1).html',
      mime: "text/html; charset=utf-8",
      kind: "html",
      size: 2048,
      source: "local",
      expiresAt: Date.now() + 60_000,
    };

    const markup = renderToStaticMarkup(createElement(FileViewer, { file, onClose: () => {} }));

    expect(markup).toContain(`<iframe src="/api/files/${file.token}/preview"`);
    expect(markup).toContain('sandbox=""');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("pointer-events-none");
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).not.toContain("allow-scripts");
    expect(markup).not.toContain("srcdoc=");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
    expect(markup).not.toContain("<script>alert(1)");
  });
});
