export const PERFORMANCE_SUMMARY_SCHEMA = "cumea.desktop-performance-summary";
export const PERFORMANCE_COMPARISON_SCHEMA = "cumea.desktop-performance-comparison";
export const PERFORMANCE_TOOLS_VERSION = 1;

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function finiteValues(values) {
  return values.filter((value) => typeof value === "number" && Number.isFinite(value));
}

export function percentile(values, fraction) {
  const sorted = finiteValues(values).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (fraction <= 0) return sorted[0];
  if (fraction >= 1) return sorted[sorted.length - 1];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

/** Aggregate {rssKb, cpuPercent} samples from a launch into one footprint.
 * Returns null when nothing usable was collected, so reports from platforms
 * without a sampler stay schema-identical to older ones. */
export function aggregateResourceSamples(samples) {
  const valid = (samples ?? []).filter(
    (sample) =>
      sample &&
      Number.isFinite(sample.rssKb) &&
      sample.rssKb >= 0 &&
      Number.isFinite(sample.cpuPercent) &&
      sample.cpuPercent >= 0,
  );
  if (!valid.length) return null;
  const rssKb = valid.map((sample) => sample.rssKb);
  const cpuPercent = valid.map((sample) => sample.cpuPercent);
  return {
    samples: valid.length,
    rssKb: { median: percentile(rssKb, 0.5), max: Math.round(Math.max(...rssKb)) },
    cpuPercent: { median: percentile(cpuPercent, 0.5), max: round(Math.max(...cpuPercent)) },
  };
}

function environmentValues(reports, key) {
  return Array.from(
    new Set(
      reports
        .map((report) => report?.metadata?.[key])
        .filter((value) => typeof value === "string" || typeof value === "boolean"),
    ),
  );
}

export function summarizePerformanceReports(
  reports,
  { label = "summary", generatedAt = new Date() } = {},
) {
  const validReports = reports.filter(
    (report) =>
      report &&
      report.schema === "cumea.desktop-performance" &&
      report.version === 1 &&
      report.durationsMs &&
      typeof report.durationsMs === "object",
  );
  if (!validReports.length) throw new Error("No valid Cumea performance reports were supplied");

  const metricNames = Array.from(
    new Set(validReports.flatMap((report) => Object.keys(report.durationsMs))),
  ).sort();
  const metrics = {};
  for (const name of metricNames) {
    const samples = finiteValues(validReports.map((report) => report.durationsMs[name]));
    if (!samples.length) continue;
    metrics[name] = {
      samples: samples.length,
      median: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      min: round(Math.min(...samples)),
      max: round(Math.max(...samples)),
    };
  }

  return {
    schema: PERFORMANCE_SUMMARY_SCHEMA,
    version: PERFORMANCE_TOOLS_VERSION,
    generatedAt: generatedAt.toISOString(),
    label,
    reports: validReports.length,
    environment: {
      platform: environmentValues(validReports, "platform"),
      arch: environmentValues(validReports, "arch"),
      packaged: environmentValues(validReports, "packaged"),
      appVersion: environmentValues(validReports, "appVersion"),
      commit: environmentValues(validReports, "commit"),
      profile: environmentValues(validReports, "profile"),
      cacheTreatment: environmentValues(validReports, "cacheTreatment"),
      runtime: environmentValues(validReports, "runtime"),
      machineFingerprint: environmentValues(validReports, "machineFingerprint"),
      machineLabel: environmentValues(validReports, "machineLabel"),
    },
    metrics,
  };
}

export function comparePerformanceSummaries(
  before,
  after,
  { generatedAt = new Date() } = {},
) {
  if (before?.schema !== PERFORMANCE_SUMMARY_SCHEMA || after?.schema !== PERFORMANCE_SUMMARY_SCHEMA) {
    throw new Error("Both inputs must be Cumea performance summaries");
  }
  const metricNames = Array.from(
    new Set([...Object.keys(before.metrics ?? {}), ...Object.keys(after.metrics ?? {})]),
  ).sort();
  const metrics = {};
  for (const name of metricNames) {
    const baseline = before.metrics?.[name]?.median;
    const candidate = after.metrics?.[name]?.median;
    if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) continue;
    const deltaMs = round(candidate - baseline);
    metrics[name] = {
      beforeMs: baseline,
      afterMs: candidate,
      deltaMs,
      changePct: baseline === 0 ? null : round((deltaMs / baseline) * 100),
    };
  }
  return {
    schema: PERFORMANCE_COMPARISON_SCHEMA,
    version: PERFORMANCE_TOOLS_VERSION,
    generatedAt: generatedAt.toISOString(),
    before: { label: before.label, reports: before.reports },
    after: { label: after.label, reports: after.reports },
    metrics,
  };
}

function markdownCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ms` : "—";
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function performanceSummaryMarkdown(summary) {
  const lines = [
    `# Desktop performance — ${markdownCell(summary.label)}`,
    "",
    `Samples: **${summary.reports}**`,
    "",
    "| Metric | Samples | Median | p95 | Min | Max |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const [name, metric] of Object.entries(summary.metrics ?? {})) {
    lines.push(
      `| ${markdownCell(name)} | ${metric.samples} | ${formatMs(metric.median)} | ${formatMs(metric.p95)} | ${formatMs(metric.min)} | ${formatMs(metric.max)} |`,
    );
  }
  lines.push("", "Environment:");
  for (const [key, values] of Object.entries(summary.environment ?? {})) {
    lines.push(`- ${key}: ${values.length ? values.map(markdownCell).join(", ") : "—"}`);
  }
  return `${lines.join("\n")}\n`;
}

export function performanceComparisonMarkdown(comparison) {
  const lines = [
    `# Desktop performance — ${markdownCell(comparison.before.label)} → ${markdownCell(comparison.after.label)}`,
    "",
    `Samples: **${comparison.before.reports}** before, **${comparison.after.reports}** after`,
    "",
    "| Metric | Before | After | Delta | Change |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const [name, metric] of Object.entries(comparison.metrics ?? {})) {
    lines.push(
      `| ${markdownCell(name)} | ${formatMs(metric.beforeMs)} | ${formatMs(metric.afterMs)} | ${formatMs(metric.deltaMs)} | ${formatPercent(metric.changePct)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
