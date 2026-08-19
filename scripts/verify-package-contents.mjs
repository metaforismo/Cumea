import { constants } from "node:fs";
import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CUA_DRIVER_RELEASE } from "./cua-driver-release.mjs";
import {
  verifyPackagedServerRuntime,
  verifySourceSpawnManifest,
} from "./package-runtime-closure.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);

async function findDirectories(directory, suffix, depth = 0) {
  if (depth > 6) return [];
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    if (target.endsWith(suffix)) matches.push(target);
    else matches.push(...(await findDirectories(target, suffix, depth + 1)));
  }
  return matches;
}

async function findFile(directory, fileName, depth = 0) {
  if (depth > 12) return undefined;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === fileName) return target;
    if (entry.isDirectory()) {
      const nested = await findFile(target, fileName, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

async function requireFile(file, minimumBytes = 1) {
  const details = await stat(file);
  if (!details.isFile() || details.size < minimumBytes) {
    throw new Error(`Missing or empty packaged file: ${file}`);
  }
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

const explicit = process.argv[2] ? path.resolve(root, process.argv[2]) : undefined;
let resources = explicit;
if (!resources) {
  const candidates = await findDirectories(path.join(root, "release"), "Cumea.app/Contents/Resources");
  if (candidates.length !== 1) {
    throw new Error(`Expected one unpacked Cumea.app, found ${candidates.length}. Pass its Resources path explicitly.`);
  }
  [resources] = candidates;
}

const required = [
  ["app.asar", 1024],
  ["ui/index.html", 64],
  ["LICENSE", 64],
  ["THIRD_PARTY_NOTICES.md", 64],
  ["licenses/mote-studio-MIT.txt", 64],
  ["licenses/cua-driver-MIT.txt", 64],
  ["licenses/cua-driver-node-runtime-NOTICE.md", 64],
  ["licenses/qrcode-react-ISC.txt", 64],
  ["licenses/react-native-markdown-display-MIT.txt", 64],
];
for (const [relative, minimumBytes] of required) {
  await requireFile(path.join(resources, relative), minimumBytes);
}

await verifySourceSpawnManifest({ sourceRoot: root });
const serverRuntime = await verifyPackagedServerRuntime(path.join(resources, "server"));

const infoPlist = path.join(resources, "..", "Info.plist");
for (const usageKey of ["NSScreenCaptureUsageDescription", "NSAppleEventsUsageDescription"]) {
  const { stdout: usageDescription } = await exec("plutil", ["-extract", usageKey, "raw", infoPlist]);
  if (!usageDescription.trim()) throw new Error(`Packaged Info.plist is missing ${usageKey}`);
}

const speechHelper = path.join(resources, "speech-helper");
await requireFile(speechHelper, 1024);
await access(speechHelper, constants.X_OK);
const { stdout: speechArchitectures } = await exec("lipo", ["-archs", speechHelper]);
if (!speechArchitectures.trim().split(/\s+/).includes("arm64")) {
  throw new Error(`Packaged speech helper is not arm64: ${speechArchitectures.trim()}`);
}

const cuaDriver = path.join(resources, "cua-driver");
await requireFile(cuaDriver, 1024);
await access(cuaDriver, constants.X_OK);
const preparedCuaDriver = path.join(root, "build", "cua-driver", "darwin-arm64", "cua-driver");
await requireFile(preparedCuaDriver, 1024);
const [packagedCuaDigest, preparedCuaDigest] = await Promise.all([sha256(cuaDriver), sha256(preparedCuaDriver)]);
if (packagedCuaDigest !== preparedCuaDigest) {
  throw new Error("Packaged cua-driver differs from the release-verified prepared executable");
}
const { stdout: cuaArchitectures } = await exec("lipo", ["-archs", cuaDriver]);
const cuaArchitectureList = cuaArchitectures.trim().split(/\s+/).filter(Boolean);
if (!cuaArchitectureList.includes("arm64")) {
  throw new Error(`Packaged cua-driver has no arm64 slice: ${cuaArchitectures.trim()}`);
}
const { stdout: cuaVersionOut, stderr: cuaVersionError } = await exec(cuaDriver, ["--version"], {
  timeout: 15_000,
});
const cuaVersion = `${cuaVersionOut}\n${cuaVersionError}`.trim();
const cuaVersionPattern = new RegExp(`(^|\\D)${CUA_DRIVER_RELEASE.version.replaceAll(".", "\\.")}($|\\D)`);
if (!cuaVersionPattern.test(cuaVersion)) {
  throw new Error(`Packaged cua-driver version mismatch: expected ${CUA_DRIVER_RELEASE.version}, received ${cuaVersion}`);
}

const unpacked = path.join(resources, "app.asar.unpacked");
const cuaRuntime = await findFile(unpacked, "cua_driver_node_runtime.node");
const cuaSdkLibrary = await findFile(unpacked, "libcua_driver_sdk.dylib");
const ubjsRuntime = await findFile(unpacked, "uniffi-runtime-napi.darwin-arm64.node");
if (!cuaRuntime || !cuaSdkLibrary || !ubjsRuntime) {
  throw new Error("Packaged local-computer native runtimes are missing from app.asar.unpacked");
}
for (const nativeRuntime of [cuaRuntime, cuaSdkLibrary, ubjsRuntime]) {
  const { stdout: runtimeArchitectures } = await exec("lipo", ["-archs", nativeRuntime]);
  if (!runtimeArchitectures.trim().split(/\s+/).includes("arm64")) {
    throw new Error(`Packaged native runtime has no arm64 slice: ${nativeRuntime}`);
  }
}

console.log(
  `Verified ${serverRuntime.entrypoints.length} packaged server entrypoints and ${serverRuntime.files.length} transitive runtime files.`,
);
console.log(`Verified unsigned package layout at ${path.relative(root, resources)}.`);
console.log("This smoke check does not establish signing, notarization, launch, or device behavior.");
