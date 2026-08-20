import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contrastRatio,
  evaluateThemeContrast,
  parseThemeTokens,
  THEME_CONTRAST_PAIRS,
} from "./check-theme-contrast.mjs";

test("composites alpha foreground colors before applying WCAG contrast", () => {
  assert.ok(Math.abs(contrastRatio("#fcfcfcbf", "#5a5a5a") - 4.607) < 0.01);
});

test("later accessibility overrides win over base theme declarations", () => {
  const tokens = parseThemeTokens([
    ":root { --color-accent: #1084fe; --color-card: #262626; }",
    ":root { --color-accent: #2a9aff; }",
  ]);
  assert.equal(tokens.get("accent"), "#2a9aff");
  assert.equal(tokens.get("card"), "#262626");
});

test("the gate catches the two low-contrast token values it was added to prevent", () => {
  const css = `
    :root {
      --color-app: #070707;
      --color-card: #262626;
      --color-inset: #191919;
      --color-bubble-user: #5a5a5a;
      --color-ink: #fcfcfc;
      --color-ink-secondary: #fcfcfc99;
      --color-accent: #1084fe;
      --color-success: #38d591;
      --color-danger: #ff5667;
      --color-warning: #ff9800;
    }
  `;
  const failures = evaluateThemeContrast(parseThemeTokens([css]), THEME_CONTRAST_PAIRS).filter((result) => !result.ok);
  const uses = failures.map((failure) => failure.use);
  assert.ok(uses.includes("small delivery metadata / user bubble"));
  assert.ok(uses.includes("normal accent text / card"));
});

test("the accessible overrides satisfy every declared semantic pair", () => {
  const css = `
    :root {
      --color-app: #070707;
      --color-card: #262626;
      --color-inset: #191919;
      --color-bubble-user: #5a5a5a;
      --color-ink: #fcfcfc;
      --color-ink-secondary: #fcfcfcbf;
      --color-accent: #2a9aff;
      --color-success: #38d591;
      --color-danger: #ff5667;
      --color-warning: #ff9800;
    }
  `;
  const failures = evaluateThemeContrast(parseThemeTokens([css]), THEME_CONTRAST_PAIRS).filter((result) => !result.ok);
  assert.deepEqual(failures, []);
});
