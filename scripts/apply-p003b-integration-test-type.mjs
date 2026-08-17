import { readFileSync, writeFileSync } from "node:fs";

const file = "server/local-listener.integration.test.ts";
let text = readFileSync(file, "utf8");
const replacements = [
  [
    'import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";\n',
    'import { spawn, type ChildProcessByStdio } from "node:child_process";\n',
  ],
  [
    'import path from "node:path";\n',
    'import path from "node:path";\nimport type { Readable } from "node:stream";\n',
  ],
  [
    'const children = new Set<ChildProcessWithoutNullStreams>();',
    'type HarnessChild = ChildProcessByStdio<null, Readable, Readable>;\n\nconst children = new Set<HarnessChild>();',
  ],
  [
    'async function stop(child: ChildProcessWithoutNullStreams) {',
    'async function stop(child: HarnessChild) {',
  ],
  [
    'async function startHarness(): Promise<{ child: ChildProcessWithoutNullStreams; port: number }> {',
    'async function startHarness(): Promise<{ child: HarnessChild; port: number }> {',
  ],
];
for (const [needle, replacement] of replacements) {
  const first = text.indexOf(needle);
  if (first < 0 || first !== text.lastIndexOf(needle)) {
    throw new Error(`expected exactly one match for ${needle.slice(0, 60)}`);
  }
  text = `${text.slice(0, first)}${replacement}${text.slice(first + needle.length)}`;
}
writeFileSync(file, text);
