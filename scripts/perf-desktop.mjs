import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { performanceSummaryMarkdown, summarizePerformanceReports } from "./perf-lib.mjs";

export const DESKTOP_RUN_SCHEMA = "cumea.desktop-performance-run";
export const DESKTOP_RUN_VERSION = 1;

const REPORT_SCHEMA = "cumea.desktop-performance";
const REPORT_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 90_000;
const BUILD_TIMEOUT_MS = 20 * 60_000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const SECRET_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "BOX_TOKEN",
  "COMPOSIO_API_KEY",
  "COMPOSIO_KEY",
  "E2B_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
];
const CONFLICTING_ENV_NAMES = [
  "CUMEA_CUA_EMBEDDED",
  "CUMEA_DATA_DIR",
  "CUMEA_PORT",
  "CUMEA_REMOTE_ACCESS",
  "CUMEA_REMOTE_ALLOW_DIRECT_BIND",
  "CUMEA_REMOTE_ALLOW_INSECURE",
  "CUMEA_REMOTE_BIND",
  "CUMEA_REMOTE_PORT",
  "CUMEA_REMOTE_PUBLIC_URL",
  "CUMEA_REMOTE_SCREEN_PREVIEW",
  "CUMEA_STATIC_DIR",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_START_URL",
];

function integerOption(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function sanitizeLabel(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64) || "desktop";
}

export function parseDesktopPerformanceArgs(
  argv,
  { platform = process.platform, env = process.env } = {},
) {
  const options = {
    label: "desktop",
    samples: 5,
    profile: "returning",
    cache: "",
    runtime: "fixture",
    app: "",
    skipBuild: false,
    out: ".context/performance",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    commit: env.GITHUB_SHA ?? "",
    machineLabel: env.CUMEA_PERFORMANCE_MACHINE_LABEL ?? "",
    help: false,
  };
  const next = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--label":
        options.label = next(index, argument);
        index += 1;
        break;
      case "--samples":
        options.samples = integerOption(next(index, argument), argument, 1, 50);
        index += 1;
        break;
      case "--profile":
        options.profile = next(index, argument);
        index += 1;
        break;
      case "--cache":
        options.cache = next(index, argument);
        index += 1;
        break;
      case "--runtime":
        options.runtime = next(index, argument);
        index += 1;
        break;
      case "--app":
        options.app = next(index, argument);
        index += 1;
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--out":
        options.out = next(index, argument);
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = integerOption(next(index, argument), argument, 10_000, 300_000);
        index += 1;
        break;
      case "--commit":
        options.commit = next(index, argument);
        index += 1;
        break;
      case "--machine-label":
        options.machineLabel = next(index, argument);
        index += 1;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.label.trim()) throw new Error("--label cannot be empty");
  if (!new Set(["first-run", "returning"]).has(options.profile)) {
    throw new Error("--profile must be first-run or returning");
  }
  if (!new Set(["fixture", "real"]).has(options.runtime)) {
    throw new Error("--runtime must be fixture or real");
  }
  if (!options.cache) options.cache = options.profile === "first-run" ? "fresh-profile" : "warm";
  if (!new Set(["fresh-profile", "warm", "chromium-cold"]).has(options.cache)) {
    throw new Error("--cache must be fresh-profile, warm, or chromium-cold");
  }
  if (options.profile === "first-run" && options.cache !== "fresh-profile") {
    throw new Error("first-run profiles require --cache fresh-profile");
  }
  if (options.profile === "returning" && options.cache === "fresh-profile") {
    throw new Error("returning profiles require --cache warm or chromium-cold");
  }
  if (options.app) options.skipBuild = true;
  if (!options.app && !options.skipBuild && platform !== "darwin") {
    throw new Error("automatic packaging is currently macOS-only; pass --app on this platform");
  }
  options.label = sanitizeLabel(options.label);
  options.commit = String(options.commit).trim().slice(0, 80);
  options.machineLabel = String(options.machineLabel).trim().slice(0, 120);
  return options;
}

export function desktopPerformanceHelp() {
  return `Usage: pnpm perf:desktop -- [options]\n\n` +
    `  --label <name>             report label (default: desktop)\n` +
    `  --samples <1-50>           measured launches (default: 5)\n` +
    `  --profile <kind>           first-run | returning\n` +
    `  --cache <kind>             fresh-profile | warm | chromium-cold\n` +
    `  --runtime <kind>           fixture | real (default: fixture)\n` +
    `  --app <path>               packaged executable or macOS .app\n` +
    `  --skip-build               reuse an existing release/ package\n` +
    `  --out <directory>          evidence root (default: .context/performance)\n` +
    `  --timeout-ms <ms>          per-launch ceiling (10000-300000)\n` +
    `  --commit <sha>             commit recorded in reports\n` +
    `  --machine-label <label>    optional non-secret machine label\n`;
}

export function machineEvidence({
  platform = process.platform,
  arch = process.arch,
  release = os.release(),
  cpus = os.cpus(),
  totalMemoryBytes = os.totalmem(),
} = {}) {
  const descriptor = {
    platform,
    arch,
    release,
    cpuModel: String(cpus[0]?.model ?? "unknown").trim().replace(/\s+/g, " ").slice(0, 160),
    logicalCpuCount: cpus.length,
    totalMemoryBytes,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(descriptor))
    .digest("hex")
    .slice(0, 16);
  return { ...descriptor, fingerprint };
}

function timestampSegment(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function executableCandidate(candidate) {
  try {
    const details = await stat(candidate);
    if (details.isDirectory() && candidate.endsWith(".app")) {
      return executableCandidate(path.join(candidate, "Contents", "MacOS", "Cumea"));
    }
    if (!details.isFile()) return null;
    await access(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return path.resolve(candidate);
  } catch {
    return null;
  }
}

async function discoverExecutables(root, depth = 0) {
  if (depth > 5) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "Cumea.app") {
        const executable = await executableCandidate(target);
        if (executable) found.push(executable);
      } else {
        found.push(...(await discoverExecutables(target, depth + 1)));
      }
    } else if (entry.isFile() && new Set(["Cumea", "Cumea.exe", "cumea"]).has(entry.name)) {
      const executable = await executableCandidate(target);
      if (executable) found.push(executable);
    }
  }
  return found;
}

export async function resolvePackagedExecutable(appPath = "", cwd = process.cwd()) {
  if (appPath) {
    const candidate = await executableCandidate(path.resolve(cwd, appPath));
    if (!candidate) throw new Error(`Packaged app is not executable: ${appPath}`);
    return candidate;
  }
  const candidates = [
    "release/mac-arm64/Cumea.app",
    "release/mac/Cumea.app",
    "release/Cumea.app",
    "release/win-unpacked/Cumea.exe",
    "release/linux-unpacked/cumea",
  ];
  for (const candidate of candidates) {
    const executable = await executableCandidate(path.join(cwd, candidate));
    if (executable) return executable;
  }
  const discovered = await discoverExecutables(path.join(cwd, "release"));
  if (discovered.length) return discovered[0];
  throw new Error("No packaged Cumea executable found under release/. Build it or pass --app.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminateProcessTree(child, platform = process.platform) {
  if (!child.pid) return;
  if (platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  await delay(750);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}

function redactText(text, values) {
  let result = text;
  for (const value of values) {
    if (!value) continue;
    const variants = new Set([String(value), String(value).replaceAll("\\", "/")]);
    for (const variant of variants) {
      if (variant) result = result.split(variant).join("<redacted-path>");
    }
  }
  return result;
}

export async function runProcess({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  timeoutMs,
  logFile,
  redactions = [],
  platform = process.platform,
  spawnImpl = spawn,
}) {
  await mkdir(path.dirname(logFile), { recursive: true, mode: 0o700 });
  const startedAt = Date.now();
  let logBytes = 0;
  let logTruncated = false;
  const chunks = [];
  const append = (source, data) => {
    if (logBytes >= MAX_LOG_BYTES) {
      logTruncated = true;
      return;
    }
    const framed = Buffer.concat([Buffer.from(`[${source}] `), Buffer.from(data)]);
    const remaining = MAX_LOG_BYTES - logBytes;
    chunks.push(framed.subarray(0, remaining));
    logBytes += Math.min(framed.length, remaining);
    if (framed.length > remaining) logTruncated = true;
  };

  const child = spawnImpl(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: platform !== "win32",
    windowsHide: true,
  });
  child.stdout?.on("data", (data) => append("stdout", data));
  child.stderr?.on("data", (data) => append("stderr", data));

  let timedOut = false;
  let settled = false;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child, platform);
    }, timeoutMs);
    timer.unref?.();
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal });
    });
  }).catch(async (error) => {
    const output = redactText(Buffer.concat(chunks).toString("utf8"), redactions);
    await writeFile(logFile, `${output}${logTruncated ? "\n[log truncated]\n" : ""}`, {
      mode: 0o600,
    });
    throw error;
  });

  const output = redactText(Buffer.concat(chunks).toString("utf8"), redactions);
  await writeFile(logFile, `${output}${logTruncated ? "\n[log truncated]\n" : ""}`, {
    mode: 0o600,
  });
  const wallDurationMs = Date.now() - startedAt;
  if (timedOut) throw new Error(`Process exceeded ${timeoutMs} ms; see ${path.basename(logFile)}`);
  if (result.code !== 0) {
    throw new Error(
      `Process exited with ${result.code ?? result.signal ?? "unknown status"}; see ${path.basename(logFile)}`,
    );
  }
  return { ...result, wallDurationMs, logTruncated };
}

export function benchmarkEnvironment({
  baseEnv = process.env,
  reportFile,
  userDataDir,
  dataDir,
  label,
  sample,
  profile,
  cache,
  runtime,
  commit,
  machineFingerprint,
  machineLabel = "",
  seedOnboarding = false,
  clearCache = false,
  clearCacheOnly = false,
}) {
  const env = { ...baseEnv };
  for (const name of Object.keys(env)) {
    if (name.startsWith("CUMEA_PERFORMANCE_")) delete env[name];
  }
  for (const name of CONFLICTING_ENV_NAMES) delete env[name];
  if (runtime === "fixture") {
    for (const name of SECRET_ENV_NAMES) delete env[name];
  }
  Object.assign(env, {
    CUMEA_DATA_DIR: dataDir,
    CUMEA_PERFORMANCE_AUTO_QUIT: clearCacheOnly ? "0" : "1",
    CUMEA_PERFORMANCE_CACHE_TREATMENT: cache,
    CUMEA_PERFORMANCE_FILE: reportFile,
    CUMEA_PERFORMANCE_LABEL: label,
    CUMEA_PERFORMANCE_MACHINE_FINGERPRINT: machineFingerprint,
    CUMEA_PERFORMANCE_PROFILE: profile,
    CUMEA_PERFORMANCE_RUNTIME: runtime,
    CUMEA_PERFORMANCE_SAMPLE: sample,
    CUMEA_PERFORMANCE_USER_DATA: userDataDir,
    CUMEA_REMOTE_ACCESS: "0",
  });
  if (commit) env.CUMEA_PERFORMANCE_COMMIT = commit;
  if (machineLabel) env.CUMEA_PERFORMANCE_MACHINE_LABEL = machineLabel;
  if (seedOnboarding) env.CUMEA_PERFORMANCE_SEED_ONBOARDING = "1";
  if (clearCache) env.CUMEA_PERFORMANCE_CLEAR_CACHE = "1";
  if (clearCacheOnly) env.CUMEA_PERFORMANCE_CLEAR_CACHE_ONLY = "1";
  if (runtime === "fixture") {
    env.CUMEA_PERFORMANCE_MODE = "1";
    env.CUMEA_PERFORMANCE_SKIP_CUA = "1";
  }
  return env;
}

export function validatePerformanceReport(
  report,
  { expectedMark, profile, cache, runtime, machineFingerprint, requirePackaged = true },
) {
  if (report?.schema !== REPORT_SCHEMA || report?.version !== REPORT_VERSION) {
    throw new Error("The packaged app did not write a supported Cumea performance report");
  }
  if (!Array.isArray(report.marks) || !report.marks.some((mark) => mark?.name === expectedMark)) {
    throw new Error(`Performance report is missing ${expectedMark}`);
  }
  if (!report.durationsMs || typeof report.durationsMs !== "object") {
    throw new Error("Performance report has no duration map");
  }
  const expected = { profile, cacheTreatment: cache, runtime, machineFingerprint };
  for (const [key, value] of Object.entries(expected)) {
    if (report.metadata?.[key] !== value) {
      throw new Error(`Performance report metadata mismatch for ${key}`);
    }
  }
  if (requirePackaged && report.metadata?.packaged !== true) {
    throw new Error("The report did not come from a packaged Electron build");
  }
  return report;
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, file);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    await rm(file, { force: true });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

function artifactPath(runDirectory, file) {
  const relative = path.relative(runDirectory, file).replaceAll(path.sep, "/");
  return relative.startsWith("../") ? path.basename(file) : relative;
}

function displayExecutable(executable, cwd) {
  const relative = path.relative(cwd, executable).replaceAll(path.sep, "/");
  return relative && !relative.startsWith("../") ? relative : path.basename(executable);
}

async function readValidatedReport(file, expected) {
  const report = JSON.parse(await readFile(file, "utf8"));
  return validatePerformanceReport(report, expected);
}

async function buildPackage({ cwd, runDirectory, platform, runProcessFn }) {
  if (platform !== "darwin") {
    throw new Error("Automatic packaging is currently supported on macOS only");
  }
  const command = platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = ["package:mac:dir"];
  const logFile = path.join(runDirectory, "logs", "build.log");
  await runProcessFn({
    command,
    args,
    cwd,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    timeoutMs: BUILD_TIMEOUT_MS,
    logFile,
    redactions: [cwd, os.homedir()],
    platform,
  });
  return { performed: true, command: `${command} ${args.join(" ")}`, log: artifactPath(runDirectory, logFile) };
}

function expectedMark(profile, clearCacheOnly) {
  if (clearCacheOnly) return "cumea:main:cache-clear-settled";
  return profile === "first-run"
    ? "cumea:renderer:onboarding-painted"
    : "cumea:renderer:shell-usable-painted";
}

export async function runDesktopPerformance(
  options,
  {
    cwd = process.cwd(),
    platform = process.platform,
    now = () => new Date(),
    machine = machineEvidence(),
    runProcessFn = runProcess,
    resolveExecutableFn = resolvePackagedExecutable,
    executableArgs = [],
    requirePackaged = true,
  } = {},
) {
  const startedAt = now();
  const runDirectory = path.resolve(
    cwd,
    options.out,
    `${sanitizeLabel(options.label)}-${timestampSegment(startedAt)}`,
  );
  const directories = {
    raw: path.join(runDirectory, "raw"),
    logs: path.join(runDirectory, "logs"),
    profiles: path.join(runDirectory, "profiles"),
    data: path.join(runDirectory, "data"),
  };
  for (const directory of Object.values(directories)) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }

  const manifestFile = path.join(runDirectory, "manifest.json");
  const manifest = {
    schema: DESKTOP_RUN_SCHEMA,
    version: DESKTOP_RUN_VERSION,
    status: "running",
    startedAt: startedAt.toISOString(),
    completedAt: null,
    label: options.label,
    commit: options.commit || null,
    scenario: {
      profile: options.profile,
      cacheTreatment: options.cache,
      runtime: options.runtime,
      samplesRequested: options.samples,
      timeoutMs: options.timeoutMs,
    },
    machine: { ...machine, label: options.machineLabel || null },
    executable: null,
    build: { performed: false, command: null, log: null },
    runs: [],
    artifacts: { summaryJson: null, summaryMarkdown: null },
    error: null,
  };
  await writeJsonAtomic(manifestFile, manifest);

  const reports = [];
  try {
    if (!options.skipBuild) {
      manifest.build = await buildPackage({ cwd, runDirectory, platform, runProcessFn });
      await writeJsonAtomic(manifestFile, manifest);
    }
    const executable = await resolveExecutableFn(options.app, cwd);
    manifest.executable = displayExecutable(executable, cwd);
    await writeJsonAtomic(manifestFile, manifest);

    const sharedUserData = path.join(directories.profiles, "returning");
    const sharedData = path.join(directories.data, "returning");
    const redactions = [cwd, runDirectory, os.homedir(), sharedUserData, sharedData];

    const launch = async ({
      kind,
      sample,
      reportFile,
      logFile,
      userDataDir,
      dataDir,
      seedOnboarding = false,
      clearCache = false,
      clearCacheOnly = false,
    }) => {
      const env = benchmarkEnvironment({
        reportFile,
        userDataDir,
        dataDir,
        label: options.label,
        sample,
        profile: options.profile,
        cache: options.cache,
        runtime: options.runtime,
        commit: options.commit,
        machineFingerprint: machine.fingerprint,
        machineLabel: options.machineLabel,
        seedOnboarding,
        clearCache,
        clearCacheOnly,
      });
      const processResult = await runProcessFn({
        command: executable,
        args: executableArgs,
        cwd,
        env,
        timeoutMs: options.timeoutMs,
        logFile,
        redactions: [...redactions, userDataDir, dataDir],
        platform,
      });
      const report = await readValidatedReport(reportFile, {
        expectedMark: expectedMark(options.profile, clearCacheOnly),
        profile: options.profile,
        cache: options.cache,
        runtime: options.runtime,
        machineFingerprint: machine.fingerprint,
        requirePackaged,
      });
      manifest.runs.push({
        kind,
        sample,
        report: artifactPath(runDirectory, reportFile),
        log: artifactPath(runDirectory, logFile),
        wallDurationMs: processResult.wallDurationMs,
        logTruncated: processResult.logTruncated,
      });
      await writeJsonAtomic(manifestFile, manifest);
      return report;
    };

    if (options.profile === "returning") {
      await rm(sharedUserData, { recursive: true, force: true });
      await rm(sharedData, { recursive: true, force: true });
      await mkdir(sharedUserData, { recursive: true, mode: 0o700 });
      await mkdir(sharedData, { recursive: true, mode: 0o700 });
      await launch({
        kind: "prime",
        sample: "prime",
        reportFile: path.join(directories.raw, "prime.json"),
        logFile: path.join(directories.logs, "prime.log"),
        userDataDir: sharedUserData,
        dataDir: sharedData,
        seedOnboarding: true,
      });
    }

    for (let index = 1; index <= options.samples; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const userDataDir =
        options.profile === "returning"
          ? sharedUserData
          : path.join(directories.profiles, `sample-${suffix}`);
      const dataDir =
        options.profile === "returning"
          ? sharedData
          : path.join(directories.data, `sample-${suffix}`);
      if (options.profile === "first-run") {
        await rm(userDataDir, { recursive: true, force: true });
        await rm(dataDir, { recursive: true, force: true });
        await mkdir(userDataDir, { recursive: true, mode: 0o700 });
        await mkdir(dataDir, { recursive: true, mode: 0o700 });
      }
      if (options.cache === "chromium-cold") {
        await launch({
          kind: "cache-clear",
          sample: `cache-clear-${suffix}`,
          reportFile: path.join(directories.raw, `cache-clear-${suffix}.json`),
          logFile: path.join(directories.logs, `cache-clear-${suffix}.log`),
          userDataDir,
          dataDir,
          clearCache: true,
          clearCacheOnly: true,
        });
      }
      reports.push(
        await launch({
          kind: "sample",
          sample: `sample-${suffix}`,
          reportFile: path.join(directories.raw, `sample-${suffix}.json`),
          logFile: path.join(directories.logs, `sample-${suffix}.log`),
          userDataDir,
          dataDir,
        }),
      );
    }

    const summary = summarizePerformanceReports(reports, {
      label: `${options.label} (${options.profile}, ${options.cache}, ${options.runtime})`,
      generatedAt: now(),
    });
    const summaryJson = path.join(runDirectory, "summary.json");
    const summaryMarkdown = path.join(runDirectory, "summary.md");
    await Promise.all([
      writeJsonAtomic(summaryJson, summary),
      writeFile(summaryMarkdown, performanceSummaryMarkdown(summary), { mode: 0o600 }),
    ]);
    manifest.status = "completed";
    manifest.completedAt = now().toISOString();
    manifest.artifacts = {
      summaryJson: artifactPath(runDirectory, summaryJson),
      summaryMarkdown: artifactPath(runDirectory, summaryMarkdown),
    };
    await writeJsonAtomic(manifestFile, manifest);
    return { runDirectory, manifest, summary };
  } catch (error) {
    manifest.status = "failed";
    manifest.completedAt = now().toISOString();
    manifest.error = redactText(error instanceof Error ? error.message : String(error), [
      cwd,
      runDirectory,
      os.homedir(),
    ]).slice(0, 2_000);
    await writeJsonAtomic(manifestFile, manifest).catch(() => undefined);
    throw error;
  }
}

export async function desktopPerformanceCli(argv = process.argv.slice(2)) {
  const options = parseDesktopPerformanceArgs(argv);
  if (options.help) {
    console.log(desktopPerformanceHelp());
    return null;
  }
  const result = await runDesktopPerformance(options);
  console.log(`Wrote packaged desktop evidence to ${result.runDirectory}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  desktopPerformanceCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
