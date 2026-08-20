import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contrastRatio,
  evaluateThemeContrast,
  parseThemeTokens,
  THEME_CONTRAST_PAIRS,
} from "./check-theme-contrast.mjs";

test("composites alpha foreground colors before applying WCAG contrast", () => {
  // 0xbf alpha is 191/255, not 0.75 exactly; preserve the exact sRGB result.
  assert.ok(Math.abs(contrastRatio("#fcfcfcbf", "#5a5a5a") - 4.623) < 0.005);
});

test("later accessibility tokens extend the inherited base theme", () => {
  const tokens = parseThemeTokens([
    ":root { --color-accent: #1084fe; --color-card: #262626; }",
    ":root { --color-accent-text: #2a9aff; --color-action-ink: #070707; }",
  ]);
  assert.equal(tokens.get("accent"), "#1084fe");
  assert.equal(tokens.get("accent-text"), "#2a9aff");
  assert.equal(tokens.get("action-ink"), "#070707");
  assert.equal(tokens.get("card"), "#262626");
});

test("the gate catches the old secondary/accent assumptions and light ink on solid semantic fills", () => {
  const css = `
    :root {
      --color-app: #070707;
      --color-card: #262626;
      --color-inset: #191919;
      --color-bubble-user: #5a5a5a;
      --color-ink: #fcfcfc;
      --color-ink-secondary: #fcfcfc99;
      --color-accent: #1084fe;
      --color-accent-text: #1084fe;
      --color-action-ink: #fcfcfc;
      --color-success: #38d591;
      --color-danger: #ff5667;
      --color-warning: #ff9800;
    }
  `;
  const failures = evaluateThemeContrast(parseThemeTokens([css]), THEME_CONTRAST_PAIRS).filter((result) => !result.ok);
  const uses = failures.map((failure) => failure.use);
  assert.ok(uses.includes("small delivery metadata / user bubble"));
  assert.ok(uses.includes("normal accent text / card"));
  assert.ok(uses.includes("small label / solid accent action"));
  assert.ok(uses.includes("small label / solid danger action"));
});

test("the accessible semantic split satisfies every declared pair without changing the accent fill", () => {
  const css = `
    :root {
      --color-app: #070707;
      --color-card: #262626;
      --color-inset: #191919;
      --color-bubble-user: #5a5a5a;
      --color-ink: #fcfcfc;
      --color-ink-secondary: #fcfcfcbf;
      --color-accent: #1084fe;
      --color-accent-text: #2a9aff;
      --color-action-ink: #070707;
      --color-success: #38d591;
      --color-danger: #ff5667;
      --color-warning: #ff9800;
    }
  `;
  const failures = evaluateThemeContrast(parseThemeTokens([css]), THEME_CONTRAST_PAIRS).filter((result) => !result.ok);
  assert.deepEqual(failures, []);
});
