import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  benchmarkEnvironment,
  machineEvidence,
  parseDesktopPerformanceArgs,
  resolvePackagedExecutable,
  runDesktopPerformance,
  runProcess,
  sanitizeLabel,
  validatePerformanceReport,
} from "./perf-desktop.mjs";

test("desktop arguments keep profile and cache semantics distinct", () => {
  assert.equal(
    parseDesktopPerformanceArgs(["--profile", "first-run"], { platform: "darwin" }).cache,
    "fresh-profile",
  );
  assert.equal(
    parseDesktopPerformanceArgs(["--skip-build", "--profile", "returning"], {
      platform: "linux",
    }).cache,
    "warm",
  );
  assert.throws(
    () =>
      parseDesktopPerformanceArgs(
        ["--profile", "returning", "--cache", "fresh-profile", "--skip-build"],
        { platform: "linux" },
      ),
    /returning profiles/,
  );
  assert.throws(
    () => parseDesktopPerformanceArgs([], { platform: "linux" }),
    /--app/,
  );
  assert.equal(sanitizeLabel("  Before / after  "), "Before-after");
});

test("fixture environment is isolated and scrubs external credentials", () => {
  const env = benchmarkEnvironment({
    baseEnv: {
      PATH: "/bin",
      XAI_API_KEY: "secret",
      COMPOSIO_API_KEY: "secret",
      ELECTRON_RUN_AS_NODE: "1",
      CUMEA_PERFORMANCE_FILE: "old",
    },
    reportFile: "/tmp/report.json",
    userDataDir: "/tmp/profile",
    dataDir: "/tmp/data",
    label: "fixture",
    sample: "sample-01",
    profile: "returning",
    cache: "warm",
    runtime: "fixture",
    commit: "abc",
    machineFingerprint: "machine",
    seedOnboarding: true,
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.XAI_API_KEY, undefined);
  assert.equal(env.COMPOSIO_API_KEY, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.CUMEA_PERFORMANCE_MODE, "1");
  assert.equal(env.CUMEA_PERFORMANCE_SKIP_CUA, "1");
  assert.equal(env.CUMEA_PERFORMANCE_SEED_ONBOARDING, "1");
  assert.equal(env.CUMEA_REMOTE_ACCESS, "0");
});

test("machine evidence excludes hostname and remains stable", () => {
  const first = machineEvidence({
    platform: "darwin",
    arch: "arm64",
    release: "26.0.0",
    cpus: [{ model: "Example CPU" }, { model: "Example CPU" }],
    totalMemoryBytes: 16,
  });
  const second = machineEvidence({
    platform: "darwin",
    arch: "arm64",
    release: "26.0.0",
    cpus: [{ model: "Example CPU" }, { model: "Example CPU" }],
    totalMemoryBytes: 16,
  });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(Object.hasOwn(first, "hostname"), false);
});

test("report validation pins scenario metadata and the expected terminal mark", () => {
  const report = {
    schema: "cumea.desktop-performance",
    version: 1,
    metadata: {
      packaged: true,
      profile: "returning",
      cacheTreatment: "warm",
      runtime: "fixture",
      machineFingerprint: "machine",
    },
    marks: [{ name: "cumea:renderer:shell-usable-painted" }],
    durationsMs: {},
  };
  assert.equal(
    validatePerformanceReport(report, {
      expectedMark: "cumea:renderer:shell-usable-painted",
      profile: "returning",
      cache: "warm",
      runtime: "fixture",
      machineFingerprint: "machine",
    }),
    report,
  );
  assert.throws(
    () =>
      validatePerformanceReport(report, {
        expectedMark: "cumea:renderer:onboarding-painted",
        profile: "returning",
        cache: "warm",
        runtime: "fixture",
        machineFingerprint: "machine",
      }),
    /missing/,
  );
});

test("packaged executable resolution accepts a macOS app bundle", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-app-"));
  try {
    const app = path.join(directory, "Cumea.app");
    const executable = path.join(app, "Contents", "MacOS", "Cumea");
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);
    assert.equal(await resolvePackagedExecutable(app, directory), executable);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runner primes returning state and summarizes only measured samples", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-runner-"));
  const fake = path.join(directory, "fake-app.mjs");
  await writeFile(
    fake,
    `
    import { mkdirSync, writeFileSync } from "node:fs";
    import path from "node:path";
    if (process.env.XAI_API_KEY) process.exit(9);
    const clearOnly = process.env.CUMEA_PERFORMANCE_CLEAR_CACHE_ONLY === "1";
    const target = clearOnly
      ? "cumea:main:cache-clear-settled"
      : process.env.CUMEA_PERFORMANCE_PROFILE === "first-run"
        ? "cumea:renderer:onboarding-painted"
        : "cumea:renderer:shell-usable-painted";
    const start = Date.now();
    const report = {
      schema: "cumea.desktop-performance",
      version: 1,
      generatedAt: new Date().toISOString(),
      metadata: {
        packaged: true,
        profile: process.env.CUMEA_PERFORMANCE_PROFILE,
        cacheTreatment: process.env.CUMEA_PERFORMANCE_CACHE_TREATMENT,
        runtime: process.env.CUMEA_PERFORMANCE_RUNTIME,
        machineFingerprint: process.env.CUMEA_PERFORMANCE_MACHINE_FINGERPRINT,
        platform: process.platform,
        arch: process.arch,
        appVersion: "test",
        commit: process.env.CUMEA_PERFORMANCE_COMMIT,
      },
      marks: [
        { name: "cumea:main:module-evaluated", source: "main", atEpochMs: start },
        { name: target, source: target.includes("renderer") ? "renderer" : "main", atEpochMs: start + 10 },
      ],
      durationsMs: { "desktop.module-to-shell-usable": 10 },
    };
    mkdirSync(path.dirname(process.env.CUMEA_PERFORMANCE_FILE), { recursive: true });
    writeFileSync(process.env.CUMEA_PERFORMANCE_FILE, JSON.stringify(report));
  `,
  );
  const original = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "must-not-leak";
  try {
    const options = {
      label: "fixture",
      samples: 2,
      profile: "returning",
      cache: "warm",
      runtime: "fixture",
      app: "fake",
      skipBuild: true,
      out: directory,
      timeoutMs: 10_000,
      commit: "abc",
      machineLabel: "test-machine",
    };
    const fixed = new Date("2026-08-17T12:00:00.000Z");
    const result = await runDesktopPerformance(options, {
      cwd: directory,
      now: () => fixed,
      machine: {
        platform: process.platform,
        arch: process.arch,
        release: "test",
        cpuModel: "test",
        logicalCpuCount: 1,
        totalMemoryBytes: 1,
        fingerprint: "machine",
      },
      resolveExecutableFn: async () => process.execPath,
      executableArgs: [fake],
    });
    assert.equal(result.summary.reports, 2);
    assert.deepEqual(
      result.manifest.runs.map((run) => run.kind),
      ["prime", "sample", "sample"],
    );
    const disk = JSON.parse(
      await readFile(path.join(result.runDirectory, "manifest.json"), "utf8"),
    );
    assert.equal(disk.status, "completed");
    assert.equal(disk.artifacts.summaryJson, "summary.json");
  } finally {
    if (original === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test("chromium-cold scenario runs cache maintenance outside measured samples", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-cold-"));
  const fake = path.join(directory, "fake-app.mjs");
  await writeFile(
    fake,
    `
    import { mkdirSync, writeFileSync } from "node:fs";
    import path from "node:path";
    const clearOnly = process.env.CUMEA_PERFORMANCE_CLEAR_CACHE_ONLY === "1";
    const target = clearOnly ? "cumea:main:cache-clear-settled" : "cumea:renderer:shell-usable-painted";
    const now = Date.now();
    mkdirSync(path.dirname(process.env.CUMEA_PERFORMANCE_FILE), { recursive: true });
    writeFileSync(process.env.CUMEA_PERFORMANCE_FILE, JSON.stringify({
      schema: "cumea.desktop-performance", version: 1,
      metadata: { packaged: true, profile: "returning", cacheTreatment: "chromium-cold", runtime: "fixture", machineFingerprint: "machine" },
      marks: [{ name: target, source: clearOnly ? "main" : "renderer", atEpochMs: now }],
      durationsMs: clearOnly ? { "main.cache-clear": 1 } : { "desktop.module-to-shell-usable": 2 },
    }));
  `,
  );
  try {
    const result = await runDesktopPerformance(
      {
        label: "cold",
        samples: 1,
        profile: "returning",
        cache: "chromium-cold",
        runtime: "fixture",
        app: "fake",
        skipBuild: true,
        out: directory,
        timeoutMs: 10_000,
        commit: "",
        machineLabel: "",
      },
      {
        cwd: directory,
        now: () => new Date("2026-08-17T13:00:00.000Z"),
        machine: {
          platform: process.platform,
          arch: process.arch,
          release: "test",
          cpuModel: "test",
          logicalCpuCount: 1,
          totalMemoryBytes: 1,
          fingerprint: "machine",
        },
        resolveExecutableFn: async () => process.execPath,
        executableArgs: [fake],
      },
    );
    assert.deepEqual(
      result.manifest.runs.map((run) => run.kind),
      ["prime", "cache-clear", "sample"],
    );
    assert.equal(result.summary.reports, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("process runner terminates a timed-out process tree", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-timeout-"));
  const script = path.join(directory, "hang.mjs");
  const log = path.join(directory, "hang.log");
  await writeFile(script, `setInterval(() => {}, 1000);`);
  try {
    await assert.rejects(
      runProcess({
        command: process.execPath,
        args: [script],
        timeoutMs: 750,
        logFile: log,
        platform: process.platform,
      }),
      /exceeded 750 ms/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
