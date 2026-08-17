import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

export const PERFORMANCE_SCHEMA = "cumea.desktop-performance";
export const PERFORMANCE_VERSION = 1;

const MAX_MARKS = 128;
const ROUNDING_FACTOR = 1_000;

export const MAIN_PERFORMANCE_MARKS = new Set([
  "cumea:main:module-evaluated",
  "cumea:main:will-finish-launching",
  "cumea:main:ready",
  "cumea:main:cache-clear-start",
  "cumea:main:cache-clear-settled",
  "cumea:main:cua-start",
  "cumea:main:cua-settled",
  "cumea:main:server-start",
  "cumea:main:server-ready",
  "cumea:main:server-failed",
  "cumea:main:window-create-start",
  "cumea:main:window-created",
  "cumea:main:window-shown",
  "cumea:main:load-url-start",
  "cumea:main:load-url-resolved",
  "cumea:main:load-url-rejected",
  "cumea:main:ready-to-show",
  "cumea:main:dom-ready",
  "cumea:main:did-finish-load",
  "cumea:main:before-quit",
]);

export const RENDERER_PERFORMANCE_MARKS = new Set([
  "cumea:renderer:entry-evaluated",
  "cumea:renderer:render-start",
  "cumea:renderer:render-submitted",
  "cumea:renderer:shell-committed",
  "cumea:renderer:shell-painted",
  "cumea:renderer:transport-connected",
  "cumea:renderer:shell-usable-committed",
  "cumea:renderer:shell-usable-painted",
  "cumea:renderer:onboarding-committed",
  "cumea:renderer:onboarding-painted",
]);

const DURATION_PAIRS = Object.freeze({
  "main.module-to-ready": ["cumea:main:module-evaluated", "cumea:main:ready"],
  "main.cache-clear": ["cumea:main:cache-clear-start", "cumea:main:cache-clear-settled"],
  "main.cua-initialization": ["cumea:main:cua-start", "cumea:main:cua-settled"],
  "main.server-startup": ["cumea:main:server-start", "cumea:main:server-ready"],
  "main.window-creation": ["cumea:main:window-create-start", "cumea:main:window-created"],
  "main.navigation": ["cumea:main:load-url-start", "cumea:main:did-finish-load"],
  "renderer.entry-to-shell-painted": [
    "cumea:renderer:entry-evaluated",
    "cumea:renderer:shell-painted",
  ],
  "renderer.entry-to-shell-usable": [
    "cumea:renderer:entry-evaluated",
    "cumea:renderer:shell-usable-painted",
  ],
  "renderer.entry-to-onboarding-painted": [
    "cumea:renderer:entry-evaluated",
    "cumea:renderer:onboarding-painted",
  ],
  "desktop.module-to-shell-usable": [
    "cumea:main:module-evaluated",
    "cumea:renderer:shell-usable-painted",
  ],
  "desktop.module-to-onboarding-painted": [
    "cumea:main:module-evaluated",
    "cumea:renderer:onboarding-painted",
  ],
});

function round(value) {
  return Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeEpochMs(timeOrigin, startTime) {
  if (!finiteNumber(timeOrigin) || !finiteNumber(startTime)) return null;
  if (timeOrigin < 0 || startTime < 0) return null;
  const atEpochMs = timeOrigin + startTime;
  return finiteNumber(atEpochMs) ? round(atEpochMs) : null;
}

export function normalizeRendererMark(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (!RENDERER_PERFORMANCE_MARKS.has(payload.name)) return null;
  const atEpochMs = normalizeEpochMs(payload.timeOrigin, payload.startTime);
  if (atEpochMs === null) return null;
  return {
    name: payload.name,
    source: "renderer",
    atEpochMs,
  };
}

export function derivePerformanceDurations(marks) {
  const firstByName = new Map();
  for (const mark of marks) {
    if (!firstByName.has(mark.name)) firstByName.set(mark.name, mark.atEpochMs);
  }
  const durations = {};
  for (const [metric, [from, to]] of Object.entries(DURATION_PAIRS)) {
    const start = firstByName.get(from);
    const end = firstByName.get(to);
    if (!finiteNumber(start) || !finiteNumber(end) || end < start) continue;
    durations[metric] = round(end - start);
  }
  return durations;
}

export function buildPerformanceReport({ marks, metadata = {}, generatedAt = new Date() }) {
  const sorted = [...marks]
    .filter((mark) => finiteNumber(mark.atEpochMs))
    .sort((a, b) => a.atEpochMs - b.atEpochMs || a.name.localeCompare(b.name));
  return {
    schema: PERFORMANCE_SCHEMA,
    version: PERFORMANCE_VERSION,
    generatedAt: generatedAt.toISOString(),
    metadata,
    marks: sorted,
    durationsMs: derivePerformanceDurations(sorted),
  };
}

export function writePerformanceReportAtomic(outputFile, report) {
  if (!outputFile) return false;
  const target = path.resolve(outputFile);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(temporary, target);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    rmSync(target, { force: true });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  return true;
}

export function createPerformanceRecorder({
  outputFile = "",
  metadata = {},
  performanceApi = performance,
  generatedAt = () => new Date(),
  autoFlush = true,
} = {}) {
  const marks = new Map();
  let flushTimer;

  const resolveMetadata = () => {
    try {
      const value = typeof metadata === "function" ? metadata() : metadata;
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  };

  const flush = () => {
    if (!outputFile) return false;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    return writePerformanceReportAtomic(
      outputFile,
      buildPerformanceReport({
        marks: marks.values(),
        metadata: resolveMetadata(),
        generatedAt: generatedAt(),
      }),
    );
  };

  const scheduleFlush = () => {
    if (!outputFile || !autoFlush) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 25);
    flushTimer.unref?.();
  };

  const record = (mark) => {
    if (marks.has(mark.name) || marks.size >= MAX_MARKS) return false;
    marks.set(mark.name, Object.freeze({ ...mark }));
    scheduleFlush();
    return true;
  };

  const markMain = (name) => {
    if (!MAIN_PERFORMANCE_MARKS.has(name) || marks.has(name)) return false;
    performanceApi.mark?.(name);
    const atEpochMs = normalizeEpochMs(performanceApi.timeOrigin, performanceApi.now());
    if (atEpochMs === null) return false;
    return record({ name, source: "main", atEpochMs });
  };

  const recordRenderer = (payload) => {
    const mark = normalizeRendererMark(payload);
    return mark ? record(mark) : false;
  };

  return {
    markMain,
    recordRenderer,
    flush,
    report: () =>
      buildPerformanceReport({
        marks: marks.values(),
        metadata: resolveMetadata(),
        generatedAt: generatedAt(),
      }),
  };
}
