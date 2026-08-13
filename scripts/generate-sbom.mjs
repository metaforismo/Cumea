import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CUA_DRIVER_RELEASE } from "./cua-driver-release.mjs";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function readOutputArgument() {
  const index = process.argv.indexOf("--output");
  if (index === -1) return path.join(root, "release", `Cumea-${manifest.version}.cdx.json`);
  const value = process.argv[index + 1];
  if (!value) throw new Error("--output requires a file path");
  return path.resolve(root, value);
}

function npmPurl(name, version) {
  const versionPart = encodeURIComponent(version);
  if (!name.startsWith("@")) return `pkg:npm/${encodeURIComponent(name)}@${versionPart}`;
  const slash = name.indexOf("/");
  const scope = encodeURIComponent(name.slice(0, slash));
  const packageName = encodeURIComponent(name.slice(slash + 1));
  return `pkg:npm/${scope}/${packageName}@${versionPart}`;
}

function licenseEntry(license) {
  if (/^[A-Za-z0-9.+-]+$/.test(license)) return { license: { id: license } };
  if (/^[A-Za-z0-9.+()\s-]+$/.test(license) && /\s(?:AND|OR|WITH)\s/.test(license)) {
    return { expression: license };
  }
  return { license: { name: license } };
}

function familyLicense(name) {
  if (/^@trycua\/cua-driver-[a-z0-9-]+$/.test(name)) return "MIT AND MPL-2.0";
  if (/^@ubjs\/node-[a-z0-9-]+$/.test(name)) return "MPL-2.0";
  if (/^lightningcss-[a-z0-9-]+$/.test(name)) return "MPL-2.0";
  return undefined;
}

function installedMetadata(dependencyPath, name) {
  const fallback = familyLicense(name);
  if (typeof dependencyPath !== "string") {
    return fallback ? { licenses: [licenseEntry(fallback)] } : {};
  }
  try {
    const packageManifest = JSON.parse(readFileSync(path.join(dependencyPath, "package.json"), "utf8"));
    const result = {};
    if (typeof packageManifest.license === "string" && packageManifest.license.trim()) {
      const license = packageManifest.license.trim();
      result.licenses = [licenseEntry(license)];
    }
    return result;
  } catch {
    return fallback ? { licenses: [licenseEntry(fallback)] } : {};
  }
}

function collectDependencies(dependencies, components) {
  if (!dependencies || typeof dependencies !== "object") return;
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency || typeof dependency !== "object" || typeof dependency.version !== "string") continue;
    const key = `${name}\0${dependency.version}`;
    if (!components.has(key)) {
      const purl = npmPurl(name, dependency.version);
      const component = {
        type: "library",
        "bom-ref": purl,
        name,
        version: dependency.version,
        scope: "required",
        purl,
      };
      const installed = installedMetadata(dependency.path, name);
      if (installed.licenses) component.licenses = installed.licenses;
      const externalReferences = [];
      if (typeof dependency.resolved === "string" && dependency.resolved.startsWith("https://")) {
        externalReferences.push({ type: "distribution", url: dependency.resolved });
      }
      if (externalReferences.length > 0) component.externalReferences = externalReferences;
      components.set(key, component);
    }
    collectDependencies(dependency.dependencies, components);
  }
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const { stdout } = await exec(
  pnpm,
  ["--recursive", "list", "--prod", "--depth", "Infinity", "--json"],
  { cwd: root, maxBuffer: 64 * 1024 * 1024 },
);
const workspaces = JSON.parse(stdout);
if (!Array.isArray(workspaces) || workspaces.length === 0) {
  throw new Error("pnpm returned no workspace dependency inventory");
}

const components = new Map();
for (const workspace of workspaces) {
  if (workspace.name !== manifest.name && typeof workspace.name === "string" && typeof workspace.version === "string") {
    const purl = npmPurl(workspace.name, workspace.version);
    const workspaceComponent = {
      type: "application",
      "bom-ref": purl,
      name: workspace.name,
      version: workspace.version,
      scope: "required",
      purl,
    };
    const installed = installedMetadata(workspace.path, workspace.name);
    if (installed.licenses) workspaceComponent.licenses = installed.licenses;
    components.set(`${workspace.name}\0${workspace.version}`, workspaceComponent);
  }
  collectDependencies(workspace.dependencies, components);
}

// electron-builder ships the standalone CUA Driver executable from a pinned,
// checksum-verified upstream release asset. It is not part of the npm graph,
// so record it explicitly in the release inventory.
components.set(`cua-driver\0${CUA_DRIVER_RELEASE.version}`, {
  type: "application",
  "bom-ref": `pkg:generic/cua-driver@${CUA_DRIVER_RELEASE.version}?download_url=${encodeURIComponent(CUA_DRIVER_RELEASE.url)}`,
  name: "cua-driver",
  version: CUA_DRIVER_RELEASE.version,
  scope: "required",
  licenses: [licenseEntry("MIT")],
  hashes: [{ alg: "SHA-256", content: CUA_DRIVER_RELEASE.sha256 }],
  externalReferences: [{ type: "distribution", url: CUA_DRIVER_RELEASE.url }],
  properties: [
    { name: "cumea:platform", value: "darwin-arm64" },
    { name: "cumea:hash-subject", value: "verified release archive" },
  ],
});

const componentList = [...components.values()].sort((left, right) =>
  left["bom-ref"].localeCompare(right["bom-ref"]),
);
if (componentList.length === 0) throw new Error("SBOM would contain no production components");

const rootPurl = npmPurl(manifest.name, manifest.version);
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    component: {
      type: "application",
      "bom-ref": rootPurl,
      name: manifest.name,
      version: manifest.version,
      purl: rootPurl,
    },
    tools: {
      components: [
        {
          type: "application",
          name: "cumea-release-scripts",
          version: manifest.version,
        },
      ],
    },
  },
  components: componentList,
};

const output = readOutputArgument();
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(root, output)} with ${componentList.length} production components.`);
