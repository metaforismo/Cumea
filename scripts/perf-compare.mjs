import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  comparePerformanceSummaries,
  performanceComparisonMarkdown,
} from "./perf-lib.mjs";

function parseArgs(argv) {
  let output = "";
  const inputs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--out") output = argv[++index] ?? "";
    else inputs.push(value);
  }
  if (inputs.length !== 2) throw new Error("Supply exactly two summary JSON files: before and after");
  if (!output.trim()) throw new Error("--out is required");
  return { beforeFile: inputs[0], afterFile: inputs[1], output };
}

export async function compareCli(argv = process.argv.slice(2)) {
  const { beforeFile, afterFile, output } = parseArgs(argv);
  const [before, after] = await Promise.all([
    readFile(beforeFile, "utf8").then(JSON.parse),
    readFile(afterFile, "utf8").then(JSON.parse),
  ]);
  const comparison = comparePerformanceSummaries(before, after);
  const stem = output.endsWith(".json") ? output.slice(0, -5) : output;
  await mkdir(path.dirname(path.resolve(stem)), { recursive: true });
  await Promise.all([
    writeFile(`${stem}.json`, `${JSON.stringify(comparison, null, 2)}\n`, { mode: 0o600 }),
    writeFile(`${stem}.md`, performanceComparisonMarkdown(comparison), { mode: 0o600 }),
  ]);
  console.log(`Wrote ${stem}.json and ${stem}.md.`);
  return comparison;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  compareCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
