import { readFileSync, writeFileSync } from "node:fs";

const file = "electron/main.mjs";
let text = readFileSync(file, "utf8");
const needle = '    CUMEA_STATIC_DIR: path.join(process.resourcesPath, "ui"),\n';
const first = text.indexOf(needle);
if (first < 0 || first !== text.lastIndexOf(needle)) {
  throw new Error("expected exactly one packaged static-dir injection");
}
text = `${text.slice(0, first)}${text.slice(first + needle.length)}`;
if (text.includes("CUMEA_STATIC_DIR")) {
  throw new Error("unexpected packaged static-dir injection remains in Electron main");
}
writeFileSync(file, text);
