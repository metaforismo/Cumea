import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENTRYPOINTS = ["main.mjs", "preload.cjs"];

function localSpecifiers(source) {
  const found = new Set();
  const patterns = [
    /\bfrom\s+["'](\.[^"']+)["']/g,
    /\bimport\s+["'](\.[^"']+)["']/g,
    /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g,
    /\brequire\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

function resolveLocalModule(importer, specifier) {
  const candidate = path.resolve(path.dirname(importer), specifier);
  const relative = path.relative(ELECTRON_DIR, candidate);
  assert.equal(
    relative.startsWith("..") || path.isAbsolute(relative),
    false,
    `${path.relative(ELECTRON_DIR, importer)} escapes electron/: ${specifier}`,
  );
  assert.equal(
    existsSync(candidate),
    true,
    `${path.relative(ELECTRON_DIR, importer)} imports missing local module ${specifier}`,
  );
  return candidate;
}

test("packaged Electron entrypoints have a complete local module graph", () => {
  const pending = ENTRYPOINTS.map((entry) => path.join(ELECTRON_DIR, entry));
  const visited = new Set();

  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.equal(existsSync(file), true, `missing Electron entrypoint ${file}`);

    const source = readFileSync(file, "utf8");
    for (const specifier of localSpecifiers(source)) {
      const resolved = resolveLocalModule(file, specifier);
      if (/\.(?:mjs|cjs|js)$/.test(resolved)) pending.push(resolved);
    }
  }

  assert.ok(visited.size >= ENTRYPOINTS.length);
});
