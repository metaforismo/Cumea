import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "build", "server-runtime");
const modules = path.join(output, "node_modules");
const rootRequire = createRequire(path.join(root, "package.json"));
const queue = [{ name: "jszip", resolver: rootRequire }];
const packages = new Map();

await rm(output, { recursive: true, force: true });
await mkdir(modules, { recursive: true });

while (queue.length > 0) {
  const { name, resolver } = queue.shift();
  if (packages.has(name)) continue;
  const packageJsonPath = resolver.resolve(`${name}/package.json`);
  const manifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const packageRoot = path.dirname(packageJsonPath);
  packages.set(name, manifest.version);
  await cp(packageRoot, path.join(modules, ...name.split("/")), {
    recursive: true,
    dereference: true,
    filter: (source) => source === packageRoot || !source.slice(packageRoot.length + 1).split(path.sep).includes("node_modules"),
  });
  const packageRequire = createRequire(packageJsonPath);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    queue.push({ name: dependency, resolver: packageRequire });
  }
}

const stagedRequire = createRequire(path.join(output, "runtime-check.cjs"));
const JSZip = stagedRequire("jszip");
if (typeof JSZip?.loadAsync !== "function") throw new Error("Staged JSZip runtime is not loadable");

const inventory = [...packages].sort(([left], [right]) => left.localeCompare(right)).map(([name, version]) => ({ name, version }));
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify({ packages: inventory }, null, 2)}\n`);
console.log(`Prepared ${inventory.length} server runtime packages in ${path.relative(root, output)}.`);
