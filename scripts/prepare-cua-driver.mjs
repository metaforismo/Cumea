import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CUA_DRIVER_RELEASE } from "./cua-driver-release.mjs";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  version: DRIVER_VERSION,
  tag: RELEASE_TAG,
  asset: ASSET_NAME,
  bytes: ASSET_BYTES,
  sha256: ASSET_SHA256,
  url: ASSET_URL,
} = CUA_DRIVER_RELEASE;
const EXPECTED_DRIVER_ENTRY = `${ASSET_NAME.slice(0, -".tar.gz".length)}/cua-driver`;

const outputDirectory = path.join(root, "build", "cua-driver", "darwin-arm64");
const archivePath = path.join(outputDirectory, ASSET_NAME);
const driverPath = path.join(outputDirectory, "cua-driver");
const metadataPath = path.join(outputDirectory, "verified-release.json");

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyArchive(file) {
  const details = await stat(file);
  if (!details.isFile() || details.size !== ASSET_BYTES) {
    throw new Error(
      `CUA archive size mismatch: expected ${ASSET_BYTES} bytes, received ${details.size}. ` +
        `Remove ${path.relative(root, file)} before retrying.`,
    );
  }

  const digest = await sha256(file);
  if (digest !== ASSET_SHA256) {
    throw new Error(
      `CUA archive SHA-256 mismatch: expected ${ASSET_SHA256}, received ${digest}. ` +
        `Remove ${path.relative(root, file)} before retrying.`,
    );
  }
}

async function downloadArchive() {
  try {
    await verifyArchive(archivePath);
    console.log(`Using verified cached ${path.relative(root, archivePath)}.`);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const response = await fetch(ASSET_URL, {
    headers: { "User-Agent": "Cumea reproducible packaging" },
    redirect: "follow",
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${ASSET_URL}: HTTP ${response.status}`);
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== ASSET_BYTES) {
    throw new Error(`CUA download Content-Length mismatch: expected ${ASSET_BYTES}, received ${declaredLength}`);
  }

  const temporaryArchive = `${archivePath}.partial-${process.pid}`;
  const hash = createHash("sha256");
  let downloadedBytes = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(temporaryArchive, { flags: "wx" }));
    const digest = hash.digest("hex");
    if (downloadedBytes !== ASSET_BYTES || digest !== ASSET_SHA256) {
      throw new Error(
        `Downloaded CUA asset failed verification: expected ${ASSET_BYTES} bytes/${ASSET_SHA256}, ` +
          `received ${downloadedBytes} bytes/${digest}`,
      );
    }
    await rename(temporaryArchive, archivePath);
  } catch (error) {
    await rm(temporaryArchive, { force: true });
    throw error;
  }
}

function safeArchivePath(entry) {
  if (!entry || path.posix.isAbsolute(entry)) return false;
  return !entry.split("/").some((component) => component === "..");
}

async function extractDriver() {
  const { stdout: listingOutput } = await execFile("tar", ["-tzf", archivePath], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const entries = listingOutput.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => !safeArchivePath(entry))) {
    throw new Error("CUA archive is empty or contains an unsafe path");
  }

  // The release also contains a CuaDriver.app copy. Cumea embeds the standalone
  // top-level CLI, whose exact path is part of this pinned release contract.
  const driverEntries = entries.filter((entry) => entry === EXPECTED_DRIVER_ENTRY);
  if (driverEntries.length !== 1) {
    throw new Error(
      `Expected exactly one ${EXPECTED_DRIVER_ENTRY} entry in the archive, found ${driverEntries.length}`,
    );
  }
  const [driverEntry] = driverEntries;

  const { stdout: verboseOutput } = await execFile("tar", ["-tvzf", archivePath, driverEntry], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const verboseLines = verboseOutput.split(/\r?\n/).filter(Boolean);
  if (verboseLines.length !== 1 || !verboseLines[0].startsWith("-")) {
    throw new Error("The cua-driver archive entry is not one unambiguous regular file");
  }

  const temporaryDriver = `${driverPath}.partial-${process.pid}`;
  try {
    const { stdout: binary } = await execFile("tar", ["-xOzf", archivePath, driverEntry], {
      encoding: null,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (!Buffer.isBuffer(binary) || binary.length < 1024) {
      throw new Error("Extracted cua-driver executable is empty or unexpectedly small");
    }
    await writeFile(temporaryDriver, binary, { flag: "wx", mode: 0o755 });
    await chmod(temporaryDriver, 0o755);
    await rename(temporaryDriver, driverPath);
  } catch (error) {
    await rm(temporaryDriver, { force: true });
    throw error;
  }
}

async function verifyDriver() {
  const details = await stat(driverPath);
  if (!details.isFile() || (details.mode & 0o111) === 0) {
    throw new Error("Prepared cua-driver is not an executable regular file");
  }

  if (process.platform === "darwin") {
    const { stdout: architectures } = await execFile("lipo", ["-archs", driverPath], {
      encoding: "utf8",
      timeout: 15_000,
    });
    const actual = architectures.trim().split(/\s+/).filter(Boolean);
    if (!actual.includes("arm64")) {
      throw new Error(`Prepared cua-driver has no arm64 slice; lipo reported: ${architectures.trim()}`);
    }

    const { stdout, stderr } = await execFile(driverPath, ["--version"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    const versionOutput = `${stdout}\n${stderr}`.trim();
    if (!new RegExp(`(^|\\D)${DRIVER_VERSION.replaceAll(".", "\\.")}($|\\D)`).test(versionOutput)) {
      throw new Error(`Prepared cua-driver version mismatch: expected ${DRIVER_VERSION}, received ${versionOutput}`);
    }
  }
}

await mkdir(outputDirectory, { recursive: true });
await downloadArchive();
await verifyArchive(archivePath);
await extractDriver();
await verifyDriver();
await writeFile(
  metadataPath,
  `${JSON.stringify(
    {
      version: DRIVER_VERSION,
      releaseTag: RELEASE_TAG,
      asset: ASSET_NAME,
      bytes: ASSET_BYTES,
      sha256: ASSET_SHA256,
      url: ASSET_URL,
    },
    null,
    2,
  )}\n`,
);

console.log(`Prepared verified CUA Driver ${DRIVER_VERSION} at ${path.relative(root, driverPath)}.`);
