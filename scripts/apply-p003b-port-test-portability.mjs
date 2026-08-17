import { readFileSync, writeFileSync } from "node:fs";

const file = "server/local-listener.integration.test.ts";
let text = readFileSync(file, "utf8");
const needle = "    expect(port).not.toBe(8799);\n";
const first = text.indexOf(needle);
if (first < 0 || first !== text.lastIndexOf(needle)) {
  throw new Error("expected exactly one fixed-port inequality assertion");
}
text = `${text.slice(0, first)}${text.slice(first + needle.length)}`;
writeFileSync(file, text);
