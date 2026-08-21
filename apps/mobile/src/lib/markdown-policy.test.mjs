import assert from "node:assert/strict";
import test from "node:test";

import {
  closeUnterminatedMarkdownFence,
  MOBILE_MARKDOWN_LINK_POLICY,
  safeMarkdownExternalUrl,
} from "../../../../shared/markdown-policy.ts";

test("mobile consumes the shared Markdown link policy", () => {
  assert.equal(safeMarkdownExternalUrl("https://example.com", MOBILE_MARKDOWN_LINK_POLICY), "https://example.com");
  assert.equal(safeMarkdownExternalUrl("mailto:hello@example.com", MOBILE_MARKDOWN_LINK_POLICY), "mailto:hello@example.com");
  assert.equal(safeMarkdownExternalUrl("javascript:alert(1)", MOBILE_MARKDOWN_LINK_POLICY), null);
  assert.equal(safeMarkdownExternalUrl("https://example.com/%0aheader", MOBILE_MARKDOWN_LINK_POLICY), null);
  assert.equal(safeMarkdownExternalUrl("https://example.com/%C2%80control", MOBILE_MARKDOWN_LINK_POLICY), null);
  assert.equal(safeMarkdownExternalUrl("https://example.com/%E2%80%AEexe.md", MOBILE_MARKDOWN_LINK_POLICY), null);
  assert.equal(safeMarkdownExternalUrl("https://example.com/%250aheader", MOBILE_MARKDOWN_LINK_POLICY), null);
  assert.equal(safeMarkdownExternalUrl("mailto:hello@example.com?subject=%250d%250aBcc:other@example.com", MOBILE_MARKDOWN_LINK_POLICY), null);
  const legitimate = "https://example.com/caf%C3%A9/%E2%9C%93";
  assert.equal(safeMarkdownExternalUrl(legitimate, MOBILE_MARKDOWN_LINK_POLICY), legitimate);
});

test("mobile closes partial streaming fences with the shared policy", () => {
  assert.equal(closeUnterminatedMarkdownFence("```ts\nconst value = 1"), "```ts\nconst value = 1\n```");
});
