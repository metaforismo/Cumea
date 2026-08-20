import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const THEME_CONTRAST_PAIRS = [
  { foreground: "ink", background: "app", minimum: 4.5, use: "primary text / app" },
  { foreground: "ink", background: "card", minimum: 4.5, use: "primary text / card" },
  { foreground: "ink", background: "bubble-user", minimum: 4.5, use: "user message text" },
  { foreground: "ink-secondary", background: "app", minimum: 4.5, use: "small secondary text / app" },
  { foreground: "ink-secondary", background: "card", minimum: 4.5, use: "small secondary text / card" },
  { foreground: "ink-secondary", background: "bubble-user", minimum: 4.5, use: "small delivery metadata / user bubble" },
  { foreground: "accent-text", background: "app", minimum: 4.5, use: "normal accent text / app" },
  { foreground: "accent-text", background: "card", minimum: 4.5, use: "normal accent text / card" },
  { foreground: "accent-text", background: "inset", minimum: 4.5, use: "normal accent text / inset" },
  { foreground: "action-ink", background: "accent", minimum: 4.5, use: "small label / solid accent action" },
  { foreground: "action-ink", background: "success", minimum: 4.5, use: "small label / solid success action" },
  { foreground: "action-ink", background: "danger", minimum: 4.5, use: "small label / solid danger action" },
  { foreground: "action-ink", background: "warning", minimum: 4.5, use: "small label / solid warning action" },
  { foreground: "success", background: "card", minimum: 4.5, use: "small success text / card" },
  { foreground: "danger", background: "card", minimum: 4.5, use: "small error text / card" },
  { foreground: "warning", background: "card", minimum: 4.5, use: "small warning text / card" },
];

export function parseThemeTokens(cssSources) {
  const tokens = new Map();
  const pattern = /--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)\s*;/g;
  for (const css of cssSources) {
    for (const match of css.matchAll(pattern)) tokens.set(match[1], match[2].toLowerCase());
  }
  return tokens;
}

function parseHex(value) {
  const hex = value.replace(/^#/, "");
  if (hex.length !== 6 && hex.length !== 8) throw new Error(`unsupported color ${value}`);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

function composite(foreground, background) {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (bg.a !== 1) throw new Error(`background ${background} must be opaque`);
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
}

function linear(channel) {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb) {
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

export function contrastRatio(foreground, background) {
  const fg = composite(foreground, background);
  const bg = composite(background, background);
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function evaluateThemeContrast(tokens, pairs = THEME_CONTRAST_PAIRS) {
  return pairs.map((pair) => {
    const foreground = tokens.get(pair.foreground);
    const background = tokens.get(pair.background);
    if (!foreground || !background) {
      return { ...pair, foreground, background, ratio: 0, ok: false, reason: "missing token" };
    }
    const ratio = contrastRatio(foreground, background);
    return { ...pair, foreground, background, ratio, ok: ratio + 1e-9 >= pair.minimum };
  });
}

export function loadEffectiveThemeTokens(paths) {
  return parseThemeTokens(paths.map((path) => readFileSync(path, "utf8")));
}

function runCli() {
  const root = new URL("../", import.meta.url);
  const paths = [new URL("src/styles.css", root), new URL("src/accessibility.css", root)].map(fileURLToPath);
  const tokens = loadEffectiveThemeTokens(paths);
  const results = evaluateThemeContrast(tokens);
  for (const result of results) {
    const ratio = result.ratio.toFixed(2);
    const marker = result.ok ? "PASS" : "FAIL";
    console.log(`${marker} ${result.use}: ${result.foreground ?? "missing"} on ${result.background ?? "missing"} = ${ratio}:1 (min ${result.minimum}:1)`);
  }
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    console.error(`theme contrast gate failed for ${failures.length} semantic pair(s)`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
