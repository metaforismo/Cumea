import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const targets = ["package.json", "electron-builder.yml", "electron", "server", "src", "dist-server", "dist"];
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".mjs", ".svg", ".ts", ".tsx", ".yml"]);

// Keep the legacy tokens split so this guard does not match its own source
// when a maintainer runs a broader repository scan.
const mouseToken = ["ma", "us"].join("");
const oldGrokToken = ["open", "grok"].join("");
const scratchToken = ["grok", "bot", "oss"].join("");
const forbidden = [
  new RegExp(["open", mouseToken].join(""), "i"),
  new RegExp(oldGrokToken, "i"),
  new RegExp(scratchToken, "i"),
  new RegExp(`\\b${mouseToken}`, "i"),
  new RegExp(`\\b${["O", "MB_"].join("")}`, "i"),
  new RegExp(`\\b${["O", "GB_"].join("")}`, "i"),
];

function filesUnder(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return filesUnder(child);
    return entry.isFile() && textExtensions.has(extname(entry.name)) ? [child] : [];
  });
}

const files = targets.flatMap((target) => {
  const path = join(root, target);
  if (!existsSync(path)) return [];
  return extname(path) ? [path] : filesUnder(path);
});

const failures = [];
for (const file of files) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (forbidden.some((pattern) => pattern.test(line))) failures.push(`${relative(root, file)}:${index + 1}`);
    });
}

if (failures.length) {
  console.error(`Legacy identity token found in:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Cumea identity check passed (${files.length} files scanned)`);
}
