import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function collectFiles(root) {
  const files = [];
  async function visit(current) {
    const details = await lstat(current);
    if (details.isSymbolicLink()) return;
    if (details.isFile()) {
      files.push({ path: current, bytes: details.size });
      return;
    }
    if (!details.isDirectory()) return;
    const entries = await readdir(current);
    for (const entry of entries.sort()) await visit(path.join(current, entry));
  }
  await visit(root);
  return files;
}

export function evaluateBudget(target, files) {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const largest = files.reduce(
    (current, file) => (!current || file.bytes > current.bytes ? file : current),
    null,
  );
  const failures = [];
  if (totalBytes > target.maxTotalBytes) {
    failures.push(`total ${totalBytes} exceeds ${target.maxTotalBytes}`);
  }
  if (largest && largest.bytes > target.maxFileBytes) {
    failures.push(`${largest.path} is ${largest.bytes}, above ${target.maxFileBytes}`);
  }
  return {
    path: target.path,
    files: files.length,
    totalBytes,
    largestFile: largest ? { path: largest.path, bytes: largest.bytes } : null,
    limits: {
      maxTotalBytes: target.maxTotalBytes,
      maxFileBytes: target.maxFileBytes,
    },
    ok: failures.length === 0,
    failures,
  };
}

function parseArgs(argv) {
  let config = "performance-budget.json";
  let output = ".context/performance/bundle-budget";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--config") config = argv[++index] ?? "";
    else if (argv[index] === "--out") output = argv[++index] ?? "";
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!config || !output) throw new Error("--config and --out require values");
  return { config, output };
}

function budgetMarkdown(report) {
  const lines = [
    "# Bundle performance budget",
    "",
    "| Path | Files | Total | Largest file | Status |",
    "|---|---:|---:|---:|---|",
  ];
  for (const target of report.targets) {
    lines.push(
      `| ${target.path} | ${target.files} | ${target.totalBytes} B | ${target.largestFile?.bytes ?? 0} B | ${target.ok ? "pass" : "fail"} |`,
    );
    for (const failure of target.failures) lines.push(`| ↳ ${failure} |  |  |  |  |`);
  }
  return `${lines.join("\n")}\n`;
}

export async function budgetCli(argv = process.argv.slice(2)) {
  const { config, output } = parseArgs(argv);
  const definition = JSON.parse(await readFile(config, "utf8"));
  if (definition?.schema !== "cumea.performance-budget" || definition.version !== 1) {
    throw new Error("Unsupported performance budget file");
  }
  if (!Array.isArray(definition.targets) || !definition.targets.length) {
    throw new Error("The performance budget has no targets");
  }
  const targets = [];
  for (const target of definition.targets) {
    if (
      typeof target?.path !== "string" ||
      !Number.isSafeInteger(target.maxTotalBytes) ||
      !Number.isSafeInteger(target.maxFileBytes) ||
      target.maxTotalBytes <= 0 ||
      target.maxFileBytes <= 0
    ) {
      throw new Error("Invalid performance budget target");
    }
    const files = await collectFiles(target.path);
    targets.push(evaluateBudget(target, files));
  }
  const report = {
    schema: "cumea.performance-budget-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    targets,
    ok: targets.every((target) => target.ok),
  };
  const stem = output.endsWith(".json") ? output.slice(0, -5) : output;
  await mkdir(path.dirname(path.resolve(stem)), { recursive: true });
  await Promise.all([
    writeFile(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
    writeFile(`${stem}.md`, budgetMarkdown(report), { mode: 0o600 }),
  ]);
  for (const target of targets) {
    console.log(
      `${target.ok ? "PASS" : "FAIL"} ${target.path}: ${target.totalBytes} bytes across ${target.files} files`,
    );
    for (const failure of target.failures) console.error(`  ${failure}`);
  }
  if (!report.ok) throw new Error("Bundle performance budget exceeded");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  budgetCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
