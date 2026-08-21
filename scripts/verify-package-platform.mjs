// Package smoke for the Windows and Linux unpacked Electron builds. This is
// the layout check only — it proves electron-builder produced a complete,
// self-contained package on each OS (asar, UI, licenses, compiled server
// runtime closure). It does not establish installer, launch, or device
// behavior; those need real machines.
import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPackagedServerRuntime } from "./package-runtime-closure.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.argv[2];
const expectArtifacts = process.argv.includes("--expect-artifacts");

if (platform !== "linux" && platform !== "win") {
  throw new Error("Usage: node scripts/verify-package-platform.mjs <linux|win> [--expect-artifacts]");
}

const unpackedName = platform === "win" ? "win-unpacked" : "linux-unpacked";
const unpacked = path.join(root, "release", unpackedName);
const resources = path.join(unpacked, "resources");

async function requireFile(file, minimumBytes = 1) {
  const details = await stat(file);
  if (!details.isFile() || details.size < minimumBytes) {
    throw new Error(`Missing or empty packaged file: ${file}`);
  }
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

const serverRuntime = await verifyPackagedServerRuntime(path.join(resources, "server"));

// The platform shell must ship with its executable and at least one locale pack.
const entries = await readdir(unpacked, { withFileTypes: true });
const executableName = platform === "win" ? "Cumea.exe" : "cumea";
const executable = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === executableName.toLowerCase());
if (!executable) {
  throw new Error(`Packaged ${unpackedName} is missing its ${executableName} executable`);
}
await access(path.join(unpacked, executable.name), constants.X_OK).catch(() => {
  if (platform === "linux") throw new Error(`Packaged executable is not runnable: ${executable.name}`);
});
const locales = (await readdir(path.join(unpacked, "locales"))).filter((name) => name.endsWith(".pak"));
if (locales.length === 0) throw new Error("Packaged locales directory is empty");

if (expectArtifacts) {
  const artifacts = await readdir(path.join(root, "release"));
  const pattern = platform === "linux" ? /^Cumea-.*\.AppImage$/ : /^Cumea-.*\.exe$/;
  if (!artifacts.some((name) => pattern.test(name))) {
    throw new Error(`Expected a distributable artifact matching ${pattern} in release/`);
  }
}

console.log(
  `Verified ${serverRuntime.entrypoints.length} packaged server entrypoints and ${serverRuntime.files.length} transitive runtime files.`,
);
console.log(`Verified unsigned ${platform} package layout at release/${unpackedName}.`);
console.log("This smoke check does not establish signing, installation, launch, or device behavior.");
