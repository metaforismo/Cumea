import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "cumea-sbom-"));
const firstOutput = path.join(outputDirectory, "first.cdx.json");
const secondOutput = path.join(outputDirectory, "second.cdx.json");

async function generate(output) {
  await exec(process.execPath, [path.join(root, "scripts", "generate-sbom.mjs"), "--output", output], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return readFile(output);
}

function hasMitLicense(component) {
  return component.licenses?.some((entry) =>
    entry?.license?.id === "MIT" || entry?.license?.name === "MIT" || entry?.expression === "MIT"
  );
}

try {
  const [first, second] = [await generate(firstOutput), await generate(secondOutput)];
  if (!first.equals(second)) throw new Error("SBOM generation is not byte-for-byte deterministic");

  const sbom = JSON.parse(first.toString("utf8"));
  const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const mobileManifest = JSON.parse(await readFile(path.join(root, "apps", "mobile", "package.json"), "utf8"));
  const mobileApp = JSON.parse(await readFile(path.join(root, "apps", "mobile", "app.json"), "utf8"));
  const landingManifest = JSON.parse(await readFile(path.join(root, "apps", "landing", "package.json"), "utf8"));
  const releaseVersions = new Set([
    rootManifest.version,
    mobileManifest.version,
    mobileApp.expo?.version,
    landingManifest.version,
  ]);
  if (releaseVersions.size !== 1 || releaseVersions.has(undefined)) {
    throw new Error(`Release manifests are not version-aligned: ${[...releaseVersions].join(", ")}`);
  }
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6") {
    throw new Error("SBOM is not CycloneDX 1.6");
  }
  if (sbom.metadata?.component?.version !== rootManifest.version) {
    throw new Error("SBOM root component does not match the release manifest version");
  }

  const components = Array.isArray(sbom.components) ? sbom.components : [];
  const duplicateReferences = components
    .map((component) => component["bom-ref"])
    .filter((reference, index, references) => references.indexOf(reference) !== index);
  if (duplicateReferences.length > 0) {
    throw new Error(`SBOM has duplicate component references: ${[...new Set(duplicateReferences)].join(", ")}`);
  }

  const missingLicenses = components
    .filter((component) => !Array.isArray(component.licenses) || component.licenses.length === 0)
    .map((component) => `${component.name}@${component.version}`);
  if (missingLicenses.length > 0) {
    throw new Error(`SBOM components without a declared license: ${missingLicenses.join(", ")}`);
  }

  const electronManifest = JSON.parse(
    await readFile(path.join(root, "node_modules", "electron", "package.json"), "utf8"),
  );
  const electron = components.find(
    (component) => component.name === "Electron" && component.type === "framework",
  );
  if (!electron || electron.version !== electronManifest.version || !hasMitLicense(electron)) {
    throw new Error("SBOM does not inventory the exact MIT-licensed Electron runtime framework");
  }
  const expectedRelease = `https://github.com/electron/electron/releases/tag/v${electronManifest.version}`;
  if (!electron.externalReferences?.some(
    (reference) => reference.type === "release-notes" && reference.url === expectedRelease,
  )) {
    throw new Error("Electron SBOM component lacks its authoritative upstream release reference");
  }

  console.log(
    `Verified Cumea ${rootManifest.version} deterministic CycloneDX 1.6 inventory: ${components.length} components, ` +
    `0 missing licenses, Electron ${electron.version}.`,
  );
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
