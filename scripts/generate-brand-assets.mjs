import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const macSource = path.join(root, "Cumea-A3R1-Liquid-Glass-iOS-Default-1024x1024@1x.png");
const mobileSource = path.join(root, "Cumea-A3R1-Liquid-Glass.icon", "Assets", "cumea-a3r1-corrected-safe-area.png");

async function resize(size, destination, input) {
  await mkdir(path.dirname(destination), { recursive: true });
  await exec("sips", [
    "--resampleHeightWidth",
    String(size),
    String(size),
    input,
    "--out",
    destination,
  ]);
}

// macOS and repository surfaces need the approved pre-rendered rounded plate
// with real transparent corners. iOS/Android receive the unmasked opaque master
// and let the operating system apply its current platform mask.
await resize(1024, path.join(root, "assets/brand/iconacumea.png"), macSource);
await resize(1024, path.join(root, "build/icon-1024.png"), macSource);
await resize(1024, path.join(root, "electron/resources/app-icon.png"), macSource);
await resize(512, path.join(root, "public/app-icon.png"), macSource);
await resize(1024, path.join(root, "apps/mobile/assets/icon.png"), mobileSource);
await resize(512, path.join(root, "apps/landing/public/icon-cumea.png"), macSource);

const temporary = await mkdtemp(path.join(tmpdir(), "cumea-brand-"));
try {
  const adaptiveContent = path.join(temporary, "adaptive-content.png");
  await resize(700, adaptiveContent, mobileSource);
  await exec("sips", [
    "--padToHeightWidth",
    "1024",
    "1024",
    "--padColor",
    "0a0a0a",
    adaptiveContent,
    "--out",
    path.join(root, "apps/mobile/assets/adaptive-icon.png"),
  ]);

  const iconset = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [64, "icon_64x64.png"],
    [128, "icon_64x64@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, filename] of iconset) {
    await resize(size, path.join(root, "build/icon.iconset", filename), macSource);
  }

  // electron-builder's maintained icon tool handles current ICNS variants;
  // iconutil cannot reliably repack its own output on every recent macOS SDK.
  const require = createRequire(import.meta.url);
  const electronBuilderEntry = require.resolve("electron-builder");
  const converterPath = path.resolve(
    path.dirname(electronBuilderEntry),
    "../../app-builder-lib/out/util/iconConverter.js",
  );
  const { convertIcon } = await import(pathToFileURL(converterPath).href);
  const result = await convertIcon({
    sources: [path.join(root, "build/icon-1024.png")],
    fallbackSources: [],
    roots: [root],
    format: "icns",
    outDir: path.join(root, "build"),
  });
  if (!result.icons.length) throw new Error("electron-builder did not generate build/icon.icns");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("Generated Cumea web, Electron, macOS, iOS, and Android icon assets.");
