import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/apply-safe-file-previews.mjs";
let source = readFileSync(path, "utf8");

const dispositionBefore = '          "content-disposition": `attachment; filename*=UTF-8\'\'${encodedName}`,\n';
const dispositionAfter = '          "content-disposition": "attachment; filename*=UTF-8\'\'" + encodedName,\n';
const dispositionCount = source.split(dispositionBefore).length - 1;
if (dispositionCount !== 2) throw new Error(`expected two nested content-disposition templates, found ${dispositionCount}`);
source = source.split(dispositionBefore).join(dispositionAfter);

const oldWorkspaceTransform = `server = replaceOnce(
  server,
  '  const selection = { ...bot.modelSelection };\\n\\n  const task = opts.track === false\\n',
  '  const selection = { ...bot.modelSelection };\\n  const localWorkspace = botWorkspaceDirectory(bot.id);\\n\\n  const task = opts.track === false\\n',
  "turn workspace",
);`;
const newWorkspaceTransform = `server = replaceOnce(
  server,
  '  const selection = { ...bot.modelSelection };\\n',
  '  const selection = { ...bot.modelSelection };\\n  const localWorkspace = botWorkspaceDirectory(bot.id);\\n',
  "turn workspace",
);`;
if (!source.includes(oldWorkspaceTransform) || source.indexOf(oldWorkspaceTransform) !== source.lastIndexOf(oldWorkspaceTransform)) {
  throw new Error("expected one pre-steering turn workspace transform");
}
source = source.replace(oldWorkspaceTransform, newWorkspaceTransform);

writeFileSync(path, source);
