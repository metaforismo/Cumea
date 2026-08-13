import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publishablePattern = /\.(?:dmg|zip|exe|msi|AppImage|deb|rpm|tar\.gz|cdx\.json)$/i;

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return path.resolve(root, value);
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

const directory = option("--directory");
const output = option("--output");
const consumed = new Set();
for (const name of ["--directory", "--output"]) {
  const index = process.argv.indexOf(name);
  if (index !== -1) {
    consumed.add(index);
    consumed.add(index + 1);
  }
}
const positional = process.argv.slice(2).filter((_, index) => !consumed.has(index + 2));

let files = positional.map((file) => path.resolve(root, file));
if (directory) {
  files.push(...(await walk(directory)).filter((file) => publishablePattern.test(file)));
}
files = [...new Set(files)].filter((file) => !output || path.resolve(file) !== output).sort();
if (files.length === 0) {
  throw new Error("No release artifacts found. Pass files or populate the --directory path first.");
}

for (const file of files) {
  if (!(await stat(file)).isFile()) throw new Error(`Not a regular file: ${file}`);
}

const lines = [];
for (const file of files) {
  const label = path.relative(root, file).split(path.sep).join("/");
  lines.push(`${await sha256(file)}  ${label}`);
}
const contents = `${lines.join("\n")}\n`;

if (output) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, contents, "utf8");
  console.log(`Wrote ${path.relative(root, output)} for ${files.length} release artifacts.`);
} else {
  process.stdout.write(contents);
}
