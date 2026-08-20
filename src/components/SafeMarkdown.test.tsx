import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeMarkdown, safePreviewPath } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  it("never injects raw HTML from model or file text", () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      text: '# title\n<script>alert("x")</script>\n<img src=x onerror=alert(1)>',
    }));
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img src=\"x\"");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
  });

  it("accepts only bounded relative preview file paths", () => {
    expect(safePreviewPath("./report.md")).toBe("./report.md");
    expect(safePreviewPath("reports/final.docx")).toBe("reports/final.docx");
    expect(safePreviewPath("paper.pdf")).toBe("paper.pdf");
    expect(safePreviewPath("../secret.md")).toBeNull();
    expect(safePreviewPath("reports/../secret.md")).toBeNull();
    expect(safePreviewPath("/etc/passwd.md")).toBeNull();
    expect(safePreviewPath("C:\\secret\\report.pdf")).toBeNull();
    expect(safePreviewPath("https://example.com/report.pdf")).toBeNull();
    expect(safePreviewPath("file:///tmp/report.pdf")).toBeNull();
    expect(safePreviewPath("script.html")).toBeNull();
  });

  it("renders safe relative file citations as buttons while leaving hostile links inert", () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      text: "Open `./report.md`, [final](docs/final.docx), [bad](../secret.md), and [web](https://example.com).",
      onOpenFile: () => {},
    }));
    expect(markup).toContain("Open ./report.md");
    expect(markup).toContain("Open docs/final.docx");
    expect(markup).not.toContain("Open ../secret.md");
    expect(markup).toContain('href="https://example.com"');
    expect(markup).toContain('rel="noreferrer noopener"');
  });
});
