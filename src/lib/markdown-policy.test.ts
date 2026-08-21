import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  closeUnterminatedMarkdownFence,
  DESKTOP_MARKDOWN_LINK_POLICY,
  MOBILE_MARKDOWN_LINK_POLICY,
  safeMarkdownExternalUrl,
} from "../../shared/markdown-policy";
import { SafeMarkdown } from "../components/SafeMarkdown";

describe("shared Markdown external-link policy", () => {
  it("keeps platform differences explicit", () => {
    expect(safeMarkdownExternalUrl(" https://example.com/docs ", DESKTOP_MARKDOWN_LINK_POLICY)).toBe("https://example.com/docs");
    expect(safeMarkdownExternalUrl("mailto:hello@example.com", DESKTOP_MARKDOWN_LINK_POLICY)).toBeNull();
    expect(safeMarkdownExternalUrl("mailto:hello@example.com", MOBILE_MARKDOWN_LINK_POLICY)).toBe("mailto:hello@example.com");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "http://example.com",
    "//example.com/path",
    "/workspace/report.md",
    "javascript%3Aalert(1)",
    "https://user:password@example.com",
    "https://example.com/%0aheader",
    "https://example.com/%C2%80control",
    "https://example.com/%E2%80%AEexe.md",
    "https://example.com/%250aheader",
    "https://example.com/%250dheader",
    "mailto:hello@example.com?subject=ok%0d%0aBcc:other@example.com",
    "mailto:hello@example.com?subject=%C2%9F",
    "mailto:hello@example.com?subject=%E2%81%A6hidden",
    "mailto:hello@example.com?subject=%250d%250aBcc:other@example.com",
  ])("rejects unsupported or ambiguous target %s", (target) => {
    expect(safeMarkdownExternalUrl(target, MOBILE_MARKDOWN_LINK_POLICY)).toBeNull();
  });

  it("rejects literal controls and malformed URLs", () => {
    expect(safeMarkdownExternalUrl("https://example.com/\nnext", MOBILE_MARKDOWN_LINK_POLICY)).toBeNull();
    expect(safeMarkdownExternalUrl("https://example.com/\u202eexe.md", MOBILE_MARKDOWN_LINK_POLICY)).toBeNull();
    expect(safeMarkdownExternalUrl("https://", MOBILE_MARKDOWN_LINK_POLICY)).toBeNull();
    expect(safeMarkdownExternalUrl(`https://example.com/${"é".repeat(1_100)}`, MOBILE_MARKDOWN_LINK_POLICY)).toBeNull();
  });

  it("preserves legitimate percent-encoded Unicode without rewriting the URL", () => {
    const https = "https://example.com/caf%C3%A9/%E2%9C%93";
    const mailto = "mailto:hello@example.com?subject=caf%C3%A9";
    expect(safeMarkdownExternalUrl(https, DESKTOP_MARKDOWN_LINK_POLICY)).toBe(https);
    expect(safeMarkdownExternalUrl(mailto, MOBILE_MARKDOWN_LINK_POLICY)).toBe(mailto);
  });
});

describe("desktop Markdown renderer boundary", () => {
  it("preserves capability-scoped file buttons while applying external-link policy", () => {
    const opened: string[] = [];
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      text: "[report](notes/report.md) [site](https://example.com) [mail](mailto:hello@example.com)",
      onOpenFile: (path: string) => opened.push(path),
    }));

    expect(markup).toContain("<button");
    expect(markup).toContain("notes/report.md");
    expect(markup).toContain('href="https://example.com"');
    expect(markup).not.toContain('href="mailto:');
    expect(opened).toEqual([]);
  });
});

describe("shared streaming Markdown fence policy", () => {
  it("temporarily closes backtick and tilde fences with matching lengths", () => {
    expect(closeUnterminatedMarkdownFence("Before\n```ts\nconst x = 1")).toBe("Before\n```ts\nconst x = 1\n```");
    expect(closeUnterminatedMarkdownFence("~~~~js\nconst x = 1")).toBe("~~~~js\nconst x = 1\n~~~~");
  });

  it("does not change complete or inline code", () => {
    const complete = "```ts\nconst x = 1\n```\nDone";
    expect(closeUnterminatedMarkdownFence(complete)).toBe(complete);
    expect(closeUnterminatedMarkdownFence("Use `code` here")).toBe("Use `code` here");
  });
});
