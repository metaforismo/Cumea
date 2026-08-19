import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || first !== source.lastIndexOf(before)) throw new Error(`${label}: expected exactly one anchor`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let source = readFileSync("server/file-capabilities.ts", "utf8");
source = replaceOnce(
  source,
  `/** The only local working directory whose model-created files may be resolved. */
export function botWorkspaceDirectory(botId: string): string {
  const directory = botWorkspacePath(botId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}
`,
  `function checkedManagedDirectory(path: string, label: string): string {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (errno(error) === "ENOENT") throw httpError(410, \`${"${label}"} is unavailable\`);
    throw Object.assign(new Error(\`could not inspect ${"${label}"}\`), { status: 500, cause: error });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw httpError(410, \`${"${label}"} is not a safe directory\`);
  try {
    return realpathSync(path);
  } catch {
    throw httpError(410, \`${"${label}"} is unavailable\`);
  }
}

/** The only local working directory whose model-created files may be resolved. */
export function botWorkspaceDirectory(botId: string): string {
  mkdirSync(BOT_WORKSPACES_DIR, { recursive: true, mode: 0o700 });
  const root = checkedManagedDirectory(BOT_WORKSPACES_DIR, "bot workspace root");
  const directory = resolve(root, validateBotId(botId));
  if (!isContained(root, directory) || directory === root) throw httpError(400, "invalid bot workspace");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  checkedManagedDirectory(directory, "bot workspace");
  return directory;
}
`,
  "workspace directory",
);
source = replaceOnce(
  source,
  `export function stageBotWorkspaceForDeletion(botId: string): StagedFileDeletion {
  const source = botWorkspacePath(botId);
`,
  `export function stageBotWorkspaceForDeletion(botId: string): StagedFileDeletion {
  const root = checkedManagedDirectory(BOT_WORKSPACES_DIR, "bot workspace root");
  const source = resolve(root, validateBotId(botId));
  if (!isContained(root, source) || source === root) throw httpError(400, "invalid bot workspace");
`,
  "workspace stage root",
);
source = replaceOnce(
  source,
  `export function readLocalBotFile(botId: string, requestedValue: unknown): ResolvedBotFile {
  const workspace = botWorkspacePath(botId);
  let root: string;
  try {
    root = realpathSync(workspace);
  } catch (error) {
    if (errno(error) === "ENOENT") throw httpError(404, "file not found in this bot's workspace");
    throw httpError(410, "this bot's workspace is unavailable");
  }
`,
  `export function readLocalBotFile(botId: string, requestedValue: unknown): ResolvedBotFile {
  const managedRoot = checkedManagedDirectory(BOT_WORKSPACES_DIR, "bot workspace root");
  const workspace = resolve(managedRoot, validateBotId(botId));
  if (!isContained(managedRoot, workspace) || workspace === managedRoot) throw httpError(400, "invalid bot workspace");
  let root: string;
  try {
    root = checkedManagedDirectory(workspace, "bot workspace");
  } catch (error) {
    if ((error as { status?: number })?.status === 410 && errno((error as { cause?: unknown }).cause) === "ENOENT") {
      throw httpError(404, "file not found in this bot's workspace");
    }
    throw error;
  }
`,
  "workspace read root",
);
source = replaceOnce(
  source,
  `  let root: string;
  try {
    root = realpathSync(lexicalRoot);
  } catch {
    throw httpError(410, "attachment storage is unavailable");
  }
`,
  `  const root = checkedManagedDirectory(lexicalRoot, "attachment storage");
`,
  "attachment root",
);
writeFileSync("server/file-capabilities.ts", source);
