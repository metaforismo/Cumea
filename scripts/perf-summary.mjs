import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { performanceSummaryMarkdown, summarizePerformanceReports } from "./perf-lib.mjs";

async function jsonFiles(input) {
  const details = await stat(input);
  if (details.isFile()) return input.endsWith(".json") ? [input] : [];
  if (!details.isDirectory()) return [];
  const entries = await readdir(input, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => jsonFiles(path.join(input, entry.name))),
  );
  return nested.flat();
}

function parseArgs(argv) {
  let label = "summary";
  let output = "";
  const inputs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--label") label = argv[++index] ?? "";
    else if (value === "--out") output = argv[++index] ?? "";
    else inputs.push(value);
  }
  if (!label.trim()) throw new Error("--label needs a non-empty value");
  if (!output.trim()) throw new Error("--out is required");
  if (!inputs.length) throw new Error("Supply at least one report file or directory");
  return { label: label.trim(), output, inputs };
}

export async function summarizeCli(argv = process.argv.slice(2)) {
  const { label, output, inputs } = parseArgs(argv);
  const files = (await Promise.all(inputs.map(jsonFiles))).flat().sort();
  const reports = [];
  for (const file of files) {
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      if (value?.schema === "cumea.desktop-performance") reports.push(value);
    } catch {
      // A directory may contain unrelated or partially-written JSON; only
      // complete Cumea reports participate in the summary.
    }
  }
  const summary = summarizePerformanceReports(reports, { label });
  const stem = output.endsWith(".json") ? output.slice(0, -5) : output;
  await mkdir(path.dirname(path.resolve(stem)), { recursive: true });
  await Promise.all([
    writeFile(`${stem}.json`, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 }),
    writeFile(`${stem}.md`, performanceSummaryMarkdown(summary), { mode: 0o600 }),
  ]);
  console.log(`Wrote ${stem}.json and ${stem}.md from ${summary.reports} report(s).`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  summarizeCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
