import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/apply-safe-file-previews.mjs";
let source = readFileSync(path, "utf8");
const before = '          "content-disposition": `attachment; filename*=UTF-8\'\'${encodedName}`,\n';
const after = '          "content-disposition": "attachment; filename*=UTF-8\'\'" + encodedName,\n';
const count = source.split(before).length - 1;
if (count !== 2) throw new Error(`expected two nested content-disposition templates, found ${count}`);
source = source.split(before).join(after);
writeFileSync(path, source);
