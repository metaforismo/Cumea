import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PERFORMANCE_SCHEMA,
  buildPerformanceReport,
  createPerformanceRecorder,
  derivePerformanceDurations,
  normalizeRendererMark,
} from "./performance.mjs";

test("renderer marks accept only the bounded allowlist and finite clocks", () => {
  assert.deepEqual(
    normalizeRendererMark({
      name: "cumea:renderer:shell-painted",
      timeOrigin: 1_000,
      startTime: 25.1254,
    }),
    {
      name: "cumea:renderer:shell-painted",
      source: "renderer",
      atEpochMs: 1_025.125,
    },
  );
  assert.deepEqual(
    normalizeRendererMark({
      name: "cumea:renderer:onboarding-painted",
      timeOrigin: 2_000,
      startTime: 50,
    }),
    {
      name: "cumea:renderer:onboarding-painted",
      source: "renderer",
      atEpochMs: 2_050,
    },
  );
  assert.equal(
    normalizeRendererMark({ name: "cumea:renderer:secret", timeOrigin: 1, startTime: 1 }),
    null,
  );
  assert.equal(
    normalizeRendererMark({
      name: "cumea:renderer:shell-painted",
      timeOrigin: Number.NaN,
      startTime: 1,
    }),
    null,
  );
});

test("duration derivation ignores missing or backwards pairs", () => {
  assert.deepEqual(
    derivePerformanceDurations([
      { name: "cumea:main:module-evaluated", source: "main", atEpochMs: 1_000 },
      { name: "cumea:main:ready", source: "main", atEpochMs: 1_075.4567 },
      { name: "cumea:main:server-start", source: "main", atEpochMs: 1_200 },
      { name: "cumea:main:server-ready", source: "main", atEpochMs: 1_190 },
    ]),
    { "main.module-to-ready": 75.457 },
  );
});

test("reports are sorted and contain shell, onboarding, and cache metrics", () => {
  const report = buildPerformanceReport({
    generatedAt: new Date("2026-08-17T12:00:00.000Z"),
    metadata: { label: "fixture" },
    marks: [
      { name: "cumea:renderer:shell-usable-painted", source: "renderer", atEpochMs: 1_500 },
      { name: "cumea:renderer:onboarding-painted", source: "renderer", atEpochMs: 1_450 },
      { name: "cumea:main:module-evaluated", source: "main", atEpochMs: 1_000 },
      { name: "cumea:main:cache-clear-start", source: "main", atEpochMs: 1_080 },
      { name: "cumea:main:cache-clear-settled", source: "main", atEpochMs: 1_100 },
      { name: "cumea:renderer:entry-evaluated", source: "renderer", atEpochMs: 1_300 },
    ],
  });
  assert.equal(report.schema, PERFORMANCE_SCHEMA);
  assert.equal(report.generatedAt, "2026-08-17T12:00:00.000Z");
  assert.deepEqual(report.marks.map((mark) => mark.name), [
    "cumea:main:module-evaluated",
    "cumea:main:cache-clear-start",
    "cumea:main:cache-clear-settled",
    "cumea:renderer:entry-evaluated",
    "cumea:renderer:onboarding-painted",
    "cumea:renderer:shell-usable-painted",
  ]);
  assert.deepEqual(report.durationsMs, {
    "main.cache-clear": 20,
    "renderer.entry-to-shell-usable": 200,
    "renderer.entry-to-onboarding-painted": 150,
    "desktop.module-to-shell-usable": 500,
    "desktop.module-to-onboarding-painted": 450,
  });
});

test("recorder deduplicates marks and writes an atomic opt-in report", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-performance-"));
  const outputFile = path.join(directory, "sample.json");
  try {
    let now = 10;
    const recorder = createPerformanceRecorder({
      outputFile,
      autoFlush: false,
      generatedAt: () => new Date("2026-08-17T12:00:00.000Z"),
      metadata: () => ({ label: "test" }),
      performanceApi: {
        timeOrigin: 1_000,
        now: () => now,
        mark: () => {},
      },
    });
    assert.equal(recorder.markMain("cumea:main:module-evaluated"), true);
    now = 20;
    assert.equal(recorder.markMain("cumea:main:module-evaluated"), false);
    assert.equal(
      recorder.recordRenderer({
        name: "cumea:renderer:shell-usable-painted",
        timeOrigin: 1_000,
        startTime: 125,
      }),
      true,
    );
    assert.equal(recorder.flush(), true);
    const disk = JSON.parse(readFileSync(outputFile, "utf8"));
    assert.equal(disk.metadata.label, "test");
    assert.equal(disk.marks.length, 2);
    assert.equal(disk.durationsMs["desktop.module-to-shell-usable"], 115);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
