import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectFiles, evaluateBudget } from "./check-performance-budget.mjs";
import {
  comparePerformanceSummaries,
  performanceComparisonMarkdown,
  performanceSummaryMarkdown,
  percentile,
  summarizePerformanceReports,
} from "./perf-lib.mjs";

function report(label, durationsMs) {
  return {
    schema: "cumea.desktop-performance",
    version: 1,
    metadata: {
      label,
      platform: "darwin",
      arch: "arm64",
      packaged: true,
      appVersion: "0.1.0",
      commit: "fixture",
    },
    durationsMs,
  };
}

test("percentiles use deterministic linear interpolation", () => {
  assert.equal(percentile([40, 10, 30, 20], 0.5), 25);
  assert.equal(percentile([10, 20], 0.95), 19.5);
  assert.equal(percentile([], 0.5), null);
});

test("summaries and comparisons retain sample evidence", () => {
  const before = summarizePerformanceReports(
    [
      report("before-1", { "desktop.module-to-shell-usable": 500, "main.navigation": 100 }),
      report("before-2", { "desktop.module-to-shell-usable": 540, "main.navigation": 120 }),
    ],
    { label: "before", generatedAt: new Date("2026-08-17T12:00:00.000Z") },
  );
  const after = summarizePerformanceReports(
    [
      report("after-1", { "desktop.module-to-shell-usable": 400, "main.navigation": 90 }),
      report("after-2", { "desktop.module-to-shell-usable": 420, "main.navigation": 100 }),
    ],
    { label: "after", generatedAt: new Date("2026-08-17T12:01:00.000Z") },
  );
  assert.equal(before.reports, 2);
  assert.equal(before.metrics["desktop.module-to-shell-usable"].median, 520);
  assert.deepEqual(before.environment.platform, ["darwin"]);

  const comparison = comparePerformanceSummaries(before, after, {
    generatedAt: new Date("2026-08-17T12:02:00.000Z"),
  });
  assert.deepEqual(comparison.metrics["desktop.module-to-shell-usable"], {
    beforeMs: 520,
    afterMs: 410,
    deltaMs: -110,
    changePct: -21.154,
  });
  assert.match(performanceSummaryMarkdown(before), /\| main\.navigation \| 2 \| 110\.0 ms/);
  assert.match(performanceComparisonMarkdown(comparison), /-21\.2%/);
});

test("bundle budgets count regular files without following symlinks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-budget-"));
  try {
    await mkdir(path.join(directory, "nested"));
    await writeFile(path.join(directory, "one.js"), "12345");
    await writeFile(path.join(directory, "nested", "two.js"), "1234567890");
    const files = await collectFiles(directory);
    const result = evaluateBudget(
      { path: directory, maxTotalBytes: 20, maxFileBytes: 9 },
      files,
    );
    assert.equal(result.totalBytes, 15);
    assert.equal(result.ok, false);
    assert.match(result.failures[0], /above 9/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
