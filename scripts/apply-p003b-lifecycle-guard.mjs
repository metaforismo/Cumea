import { readFileSync, writeFileSync } from "node:fs";

const file = "electron/main.mjs";
let text = readFileSync(file, "utf8");
const needle = `  const proc = await startServerProcess();\n  if (!proc || isQuitting) return false;\n  serverReady = true;\n  desktopGateway?.setHarnessTarget(SERVER_PORT);`;
const replacement = `  const proc = await startServerProcess();\n  if (!proc || isQuitting || serverProc !== proc) return false;\n  serverReady = true;\n  desktopGateway?.setHarnessTarget(SERVER_PORT);`;
const first = text.indexOf(needle);
if (first < 0 || first !== text.lastIndexOf(needle)) {
  throw new Error("expected exactly one initial harness attach block");
}
text = `${text.slice(0, first)}${replacement}${text.slice(first + needle.length)}`;
writeFileSync(file, text);
