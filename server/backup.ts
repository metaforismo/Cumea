import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import JSZip from "jszip";

import { writeFileAtomic } from "./atomic.ts";
import { validateSchedule } from "./routines.ts";
import { validRunCheckpoint } from "./run-checkpoint.ts";
import { parseTaskBudget, validTaskBudgetUsage } from "./task-budget.ts";
import { parseBotAvatar, parseBotLifecycle } from "./store.ts";
import {
  SKILL_MAX_ASSIGNMENTS,
  SKILL_MAX_INSTRUCTION_BYTES,
  SKILL_MAX_PACKAGES,
  SKILL_MAX_VERSIONS,
  SkillRegistry,
  validateSkillAssignment,
  validateSkillManifest,
} from "./skill-registry.ts";

export const BACKUP_FORMAT = "cumea-backup" as const;
export const BACKUP_FORMAT_VERSION = 1;
export const CUMEA_DATA_SCHEMA_VERSION = 1;
export const BACKUP_MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
export const BACKUP_MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
export const BACKUP_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const BACKUP_MAX_FILES = 5_000;

const BOT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const THREAD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_ARCHIVE_PATH = /^(?:manifest\.json|payload\/[A-Za-z0-9._+/-]+)$/;
const SENSITIVE_FILE_NAME = /(?:^|[._-])(?:auth|credential|credentials|cookie|cookies|keychain|oauth|pairing|password|secret|session|token)(?:$|[._-])/i;
const HIGH_CONFIDENCE_SECRET = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|cumea_device_[A-Za-z0-9_-]{20,}|ExpoPushToken\[[^\]]+\])/;
const BOT_COLORS = new Set(["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"]);
const BOT_EXPRESSIONS = new Set(["deadpan", "friendly", "focused", "thinking", "excited", "sleepy", "surprised", "skeptical", "worried", "mischievous"]);
const MESSAGE_KINDS = new Set(["text", "options", "activity", "screen", "handoff", "context"]);
const MESSAGE_ROLES = new Set(["bot", "user"]);
const MAX_JSON_NODES = 200_000;
const MAX_MESSAGES = 50_000;

export type BackupScope = { kind: "full" } | { kind: "agent"; botId: string };

export interface BackupManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  dataSchemaVersion: typeof CUMEA_DATA_SCHEMA_VERSION;
  createdAt: string;
  scope: { kind: "full" | "agent"; botIds: string[] };
  files: BackupManifestFile[];
  exclusions: string[];
  skippedWorkspaceFiles: number;
}

export interface BackupInspection {
  manifest: BackupManifest;
  fileCount: number;
  expandedBytes: number;
  botCount: number;
  attachmentCount: number;
  warnings: string[];
}

export interface RestoreResult extends BackupInspection {
  dryRun: boolean;
  preRestoreBackup?: string;
}

interface BackupOptions {
  dataDir: string;
  now?: () => number;
}

interface RestoreOptions {
  dryRun?: boolean;
  reload?: () => void;
  failureInjection?: "before-swap" | "after-old-rename" | "after-new-rename";
}

interface PortableBot extends Record<string, unknown> {
  id: string;
  threadId: string;
}

interface PortableAttachment extends Record<string, unknown> {
  id: string;
  botId: string;
  threadId: string;
  size: number;
  storedPath: string;
}

interface PortableWorkspace extends Record<string, unknown> {
  sections: Array<Record<string, unknown>>;
  attachments: PortableAttachment[];
  tasks: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  routines: Array<Record<string, unknown>>;
}

interface ValidatedArchive {
  inspection: BackupInspection;
  files: Map<string, Buffer>;
  bots: PortableBot[];
  workspace: PortableWorkspace;
}

function httpError(status: number, message: string, cause?: unknown): Error {
  return Object.assign(new Error(message), { status, ...(cause === undefined ? {} : { cause }) });
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonStrict(path: string, fallback: unknown, label: string): unknown {
  let before: ReturnType<typeof lstatSync>;
  try {
    before = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw httpError(409, `${label} is corrupt; repair it before exporting`, error);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > BACKUP_MAX_FILE_BYTES) {
    throw httpError(409, `${label} is corrupt; repair it before exporting`);
  }
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size !== before.size) throw new Error("persistence file changed while opening");
    const bytes = readFileSync(fd);
    if (bytes.length !== opened.size) throw new Error("persistence file changed while reading");
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw httpError(409, `${label} is corrupt; repair it before exporting`, error);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  if (bytes.length > BACKUP_MAX_FILE_BYTES) throw httpError(413, `${label} is too large`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw httpError(400, `${label} is not valid JSON`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeId(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw httpError(400, `invalid ${label}`);
  return value;
}

function boundedString(value: unknown, label: string, maxBytes: number, allowEmpty = true): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw httpError(400, `${label} is invalid or too large`);
  }
  return value;
}

function safeTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw httpError(400, `${label} is invalid`);
  return Number(value);
}

/** Bound generic JSON complexity before any consumer traverses imported data. */
function validateJsonBounds(value: unknown, label: string): void {
  let nodes = 0;
  const visit = (entry: unknown, depth: number) => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > 20) throw httpError(400, `${label} is too complex`);
    if (typeof entry === "string") {
      if (Buffer.byteLength(entry, "utf8") > 2 * 1024 * 1024) throw httpError(400, `${label} contains an oversized string`);
      return;
    }
    if (typeof entry === "number" && (!Number.isFinite(entry) || !Number.isSafeInteger(entry))) throw httpError(400, `${label} contains an invalid number`);
    if (Array.isArray(entry)) {
      if (entry.length > 50_000) throw httpError(400, `${label} contains an oversized array`);
      for (const child of entry) visit(child, depth + 1);
      return;
    }
    if (isPlainRecord(entry)) {
      const rows = Object.entries(entry);
      if (rows.length > 200) throw httpError(400, `${label} contains an oversized object`);
      for (const [key, child] of rows) {
        boundedString(key, `${label} key`, 240, false);
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
}

function validateContext(value: unknown, label: string): void {
  if (!isPlainRecord(value)) throw httpError(400, `${label} is invalid`);
  safeId(value.id, BOT_ID, `${label} id`);
  boundedString(value.label, `${label} label`, 2_000);
  safeTimestamp(value.startedAt, `${label} timestamp`);
}

function validatePortableBotShape(bot: PortableBot): void {
  boundedString(bot.name, "agent name", 500, false);
  boundedString(bot.title, "agent title", 2_000);
  boundedString(bot.description, "agent description", 20_000);
  if (typeof bot.notifications !== "boolean" || typeof bot.unread !== "boolean" || typeof bot.busy !== "boolean") throw httpError(400, "agent flags are invalid");
  if (typeof bot.color !== "string" || !BOT_COLORS.has(bot.color)) throw httpError(400, "agent color is invalid");
  if (!parseBotAvatar(bot.avatar)) throw httpError(400, "agent avatar is invalid");
  if (!isPlainRecord(bot.modelSelection)) throw httpError(400, "agent model selection is invalid");
  // Empty strings are the canonical offline/no-provider selection. They are
  // safe and must remain portable even when the referenced provider is not
  // installed on the destination host.
  boundedString(bot.modelSelection.instanceId, "agent provider instance", 200);
  boundedString(bot.modelSelection.model, "agent model", 500);
  safeTimestamp(bot.createdAt, "agent creation timestamp");
  if (bot.mascotExpression !== undefined && bot.mascotExpression !== null && (typeof bot.mascotExpression !== "string" || !BOT_EXPRESSIONS.has(bot.mascotExpression))) {
    throw httpError(400, "agent expression is invalid");
  }
  if (bot.computer !== undefined && !["cloud", "vm", "local", "off"].includes(String(bot.computer))) throw httpError(400, "agent computer setting is invalid");
  if (bot.sectionId !== undefined && bot.sectionId !== null) safeId(bot.sectionId, BOT_ID, "agent section id");
  for (const key of ["appsEnabled", "collaborationEnabled", "coordinator", "memoryWriteEnabled", "pinned", "hidden", "rewound"] as const) {
    if (bot[key] !== undefined && typeof bot[key] !== "boolean") throw httpError(400, `agent ${key} flag is invalid`);
  }
  if (bot.lifecycle !== undefined && !parseBotLifecycle(bot.lifecycle)) throw httpError(400, "agent lifecycle is invalid");
  if (bot.context !== undefined) validateContext(bot.context, "agent context");
  validateJsonBounds(bot, "agent record");
}

function validateTranscript(value: unknown): Set<string> {
  validateJsonBounds(value, "transcript");
  if (!isPlainRecord(value) || !Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES) throw httpError(400, "transcript container is invalid");
  const ids = new Set<string>();
  for (const message of value.messages) {
    if (!isPlainRecord(message)) throw httpError(400, "transcript message is invalid");
    const id = safeId(message.id, BOT_ID, "message id");
    if (ids.has(id)) throw httpError(400, "transcript contains duplicate message ids");
    ids.add(id);
    if (typeof message.role !== "string" || !MESSAGE_ROLES.has(message.role) || typeof message.kind !== "string" || !MESSAGE_KINDS.has(message.kind)) {
      throw httpError(400, "transcript message kind is invalid");
    }
    safeTimestamp(message.at, "message timestamp");
    if (message.parentId !== undefined && message.parentId !== null) safeId(message.parentId, BOT_ID, "message parent id");
    if (message.text !== undefined) boundedString(message.text, "message text", 2 * 1024 * 1024);
    if (message.delivery !== undefined && !["queued", "sent", "cancelled", "failed"].includes(String(message.delivery))) throw httpError(400, "message delivery state is invalid");
    if (message.mime !== undefined) boundedString(message.mime, "message MIME type", 240, false);
    if (message.png !== undefined) boundedString(message.png, "message screen image", 12 * 1024 * 1024, false);
    if (message.context !== undefined) validateContext(message.context, "message context");
    if (message.attachments !== undefined) {
      if (!Array.isArray(message.attachments) || message.attachments.length > 100) throw httpError(400, "message attachments are invalid");
      for (const attachment of message.attachments) {
        if (!isPlainRecord(attachment)) throw httpError(400, "message attachment is invalid");
        safeId(attachment.id, BOT_ID, "message attachment id");
        boundedString(attachment.name, "message attachment name", 1_000, false);
        boundedString(attachment.mime, "message attachment MIME type", 240, false);
        if (!Number.isSafeInteger(attachment.size) || Number(attachment.size) < 0 || Number(attachment.size) > BACKUP_MAX_FILE_BYTES) throw httpError(400, "message attachment size is invalid");
      }
    }
    if (message.kind === "options" && (!isPlainRecord(message.card) || !Array.isArray(message.card.options) || message.card.options.length > 100)) throw httpError(400, "message option card is invalid");
    if (message.kind === "activity" && message.tool !== undefined && (!isPlainRecord(message.tool) || typeof message.tool.name !== "string")) throw httpError(400, "message activity is invalid");
    if (message.kind === "handoff" && !isPlainRecord(message.handoff)) throw httpError(400, "message handoff is invalid");
    if (message.kind === "context" && message.context === undefined) throw httpError(400, "context message has no context payload");
  }
  for (const message of value.messages) {
    if (!isPlainRecord(message)) continue;
    if (typeof message.parentId === "string" && (!ids.has(message.parentId) || message.parentId === message.id)) throw httpError(400, "message parent relationship is invalid");
  }
  if (value.activeLeafId !== null && (typeof value.activeLeafId !== "string" || !ids.has(value.activeLeafId))) throw httpError(400, "transcript active leaf is invalid");
  return ids;
}

function validateMemory(value: unknown, botId: string): void {
  validateJsonBounds(value, "memory");
  if (!isPlainRecord(value) || value.version !== 1 || value.botId !== botId || !Array.isArray(value.documents) || value.documents.length > 100) throw httpError(400, "memory container is invalid");
  const documentIds = new Set<string>();
  for (const document of value.documents) {
    if (!isPlainRecord(document)) throw httpError(400, "memory document is invalid");
    const id = safeId(document.id, BOT_ID, "memory document id");
    if (documentIds.has(id)) throw httpError(400, "memory contains duplicate documents");
    documentIds.add(id);
    boundedString(document.path, "memory path", 120, false);
    if (typeof document.pinned !== "boolean") throw httpError(400, "memory pin is invalid");
    safeTimestamp(document.createdAt, "memory creation timestamp");
    safeTimestamp(document.updatedAt, "memory update timestamp");
    if (!Array.isArray(document.revisions) || !document.revisions.length || document.revisions.length > 50) throw httpError(400, "memory revisions are invalid");
    const revisions = new Set<string>();
    for (const revision of document.revisions) {
      if (!isPlainRecord(revision)) throw httpError(400, "memory revision is invalid");
      const revisionId = safeId(revision.id, BOT_ID, "memory revision id");
      if (revisions.has(revisionId)) throw httpError(400, "memory contains duplicate revisions");
      revisions.add(revisionId);
      if (!Number.isSafeInteger(revision.revision) || Number(revision.revision) < 1 || !Number.isSafeInteger(revision.usedForAnswerCount) || Number(revision.usedForAnswerCount) < 0) throw httpError(400, "memory revision counters are invalid");
      boundedString(revision.content, "memory content", 16 * 1024, false);
      if (!isPlainRecord(revision.provenance) || !["user", "agent"].includes(String(revision.provenance.source))) throw httpError(400, "memory provenance is invalid");
      safeTimestamp(revision.provenance.createdAt, "memory provenance timestamp");
      if (revision.lastUsedAt !== undefined) safeTimestamp(revision.lastUsedAt, "memory usage timestamp");
      if (revision.lastUsedTurnId !== undefined) safeId(revision.lastUsedTurnId, BOT_ID, "memory turn id");
    }
  }
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function validateArchivePath(raw: string): string {
  if (
    !raw || raw.length > 512 || raw.includes("\\") || raw.includes("\0") || raw.startsWith("/") ||
    raw.split("/").some((part) => !part || part === "." || part === "..") || !SAFE_ARCHIVE_PATH.test(raw)
  ) throw httpError(400, "backup contains an unsafe path");
  return raw;
}

function collectKnownSecrets(dataDir: string): string[] {
  const values: string[] = [];
  const walk = (value: unknown, key = "") => {
    if (typeof value === "string") {
      if (/(?:key|password|secret|token|cookie|session|environment)/i.test(key) && value.length >= 6) values.push(value);
      return;
    }
    if (Array.isArray(value)) return value.forEach((entry) => walk(entry, key));
    if (isPlainRecord(value)) for (const [name, entry] of Object.entries(value)) walk(entry, name);
  };
  walk(readJsonStrict(join(dataDir, "config.json"), {}, "configuration secret registry"));
  walk(readJsonStrict(join(dataDir, "mcp-servers.json"), {}, "MCP secret registry"));
  walk(readJsonStrict(join(dataDir, "mobile-devices.json"), {}, "paired-device secret registry"));
  return [...new Set(values)].sort((left, right) => right.length - left.length).slice(0, 1_000);
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) if (secret && redacted.includes(secret)) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|cumea_device_[A-Za-z0-9_-]{20,}|ExpoPushToken\[[^\]]+\])/g, "[REDACTED]");
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, secrets));
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactValue(entry, secrets)]));
}

function portableBot(raw: unknown, secrets: readonly string[], scope: BackupScope = { kind: "full" }): PortableBot | null {
  if (!isPlainRecord(raw)) return null;
  const id = typeof raw.id === "string" && BOT_ID.test(raw.id) ? raw.id : null;
  const threadId = typeof raw.threadId === "string" && THREAD_ID.test(raw.threadId) ? raw.threadId : null;
  if (!id || !threadId) return null;
  const copy = redactValue(structuredClone(raw), secrets) as PortableBot;
  copy.id = id;
  copy.threadId = threadId;
  copy.busy = false;
  copy.resumeCursors = {};
  // Scoped approval grants live in approval-rules.json and are deliberately
  // absent from portable exports. Do not revive the legacy global setting.
  delete copy.approvalPolicy;
  copy.memoryWriteEnabled = false;
  delete copy.mcpServerIds;
  if (scope.kind === "agent") delete copy.skillAssignments;
  validatePortableBotShape(copy);
  return copy;
}

function emptyWorkspace(): PortableWorkspace {
  return { sections: [], attachments: [], tasks: [], runs: [], routines: [] };
}

function portableWorkspace(raw: unknown, botIds: Set<string>, scope: BackupScope, secrets: readonly string[]): PortableWorkspace {
  if (!isPlainRecord(raw)) throw httpError(409, "workspace database has an invalid shape");
  const input = raw;
  const rows = (key: string) => {
    if (!Array.isArray(input[key]) || input[key].some((row) => !isPlainRecord(row))) {
      throw httpError(409, `workspace ${key} collection is corrupt`);
    }
    return input[key] as Array<Record<string, unknown>>;
  };
  const ownsBot = (row: Record<string, unknown>) => typeof row.botId === "string" && botIds.has(row.botId);
  if (scope.kind === "full") {
    for (const key of ["attachments", "tasks", "runs", "routines"] as const) {
      if (rows(key).some((row) => !ownsBot(row))) throw httpError(409, `workspace ${key} contains an unowned record`);
    }
  }
  const attachments = rows("attachments").filter(ownsBot).map((row): PortableAttachment => {
    if (typeof row.id !== "string" || !BOT_ID.test(row.id) || typeof row.threadId !== "string" || !THREAD_ID.test(row.threadId)) {
      throw httpError(409, "workspace attachment metadata is corrupt");
    }
    const size = Number(row.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > BACKUP_MAX_FILE_BYTES || typeof row.storedPath !== "string") {
      throw httpError(409, "workspace attachment metadata is corrupt");
    }
    boundedString(row.name, "attachment name", 1_000, false);
    boundedString(row.mime, "attachment MIME type", 240, false);
    safeTimestamp(row.createdAt, "attachment creation timestamp");
    return { ...(redactValue(row, secrets) as Record<string, unknown>), id: row.id, botId: String(row.botId), threadId: row.threadId, size, storedPath: `attachments/${row.id}` };
  });
  const tasks = rows("tasks").filter(ownsBot);
  if (tasks.some((row) => typeof row.id !== "string" || !BOT_ID.test(row.id))) throw httpError(409, "workspace task metadata is corrupt");
  const taskIds = new Set(tasks.flatMap((row) => typeof row.id === "string" ? [row.id] : []));
  const routines = rows("routines").filter(ownsBot);
  if (routines.some((row) => typeof row.id !== "string" || !BOT_ID.test(row.id))) throw httpError(409, "workspace routine metadata is corrupt");
  const routineIds = new Set(routines.flatMap((row) => typeof row.id === "string" ? [row.id] : []));
  const runs = rows("runs").filter((row) => ownsBot(row) && typeof row.taskId === "string" && taskIds.has(row.taskId));
  const ownedRuns = rows("runs").filter(ownsBot);
  if (runs.length !== ownedRuns.length || runs.some((row) => typeof row.id !== "string" || !BOT_ID.test(row.id))) {
    throw httpError(409, "workspace run metadata is corrupt");
  }
  return redactValue({
    sections: scope.kind === "full" ? rows("sections") : [],
    attachments,
    tasks,
    runs,
    routines: routines.filter((row) => typeof row.id !== "string" || routineIds.has(row.id)),
  }, secrets) as PortableWorkspace;
}

function workspaceFileLooksSafe(path: string, bytes: Buffer, secrets: readonly string[]): boolean {
  if (SENSITIVE_FILE_NAME.test(basename(path))) return false;
  // Scan the complete bounded byte snapshot, including binary and large text.
  // Application-managed secret values are ASCII/UTF-8, so byte matching does
  // not depend on a file being classified as text.
  if (secrets.some((secret) => secret && bytes.includes(Buffer.from(secret, "utf8")))) return false;
  if (HIGH_CONFIDENCE_SECRET.test(bytes.toString("latin1"))) return false;
  return true;
}

function readManagedAttachment(dataDir: string, botId: string, sourcePath: string, expectedBytes: number): Buffer {
  const lexicalRoot = resolve(dataDir, "attachments", botId);
  const candidate = resolve(sourcePath);
  if (!isContained(lexicalRoot, candidate)) throw httpError(409, "attachment metadata points outside managed storage");
  let root: string;
  let canonical: string;
  try {
    root = realpathSync(lexicalRoot);
    canonical = realpathSync(candidate);
  } catch (error) {
    throw httpError(409, "attachment payload is missing", error);
  }
  if (!isContained(root, canonical)) throw httpError(409, "attachment resolves outside managed storage");
  const before = lstatSync(candidate);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== expectedBytes || before.size > BACKUP_MAX_FILE_BYTES) {
    throw httpError(409, "attachment changed during export");
  }
  let fd: number | null = null;
  try {
    fd = openSync(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size !== before.size || realpathSync(candidate) !== canonical) throw httpError(409, "attachment changed while opening");
    const bytes = readFileSync(fd);
    if (bytes.length !== expectedBytes || realpathSync(candidate) !== canonical) throw httpError(409, "attachment changed while reading");
    return bytes;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function walkRegularFiles(root: string): Array<{ relativePath: string; bytes: Buffer }> {
  if (!existsSync(root)) return [];
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw httpError(409, "agent workspace root is not a safe directory");
  const canonicalRoot = realpathSync(root);
  const result: Array<{ relativePath: string; bytes: Buffer }> = [];
  const visit = (directory: string) => {
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw httpError(409, "agent workspace directory changed during export");
    const canonicalDirectory = realpathSync(directory);
    if (!isContained(canonicalRoot, canonicalDirectory)) throw httpError(409, "agent workspace directory escaped managed storage");
    for (const name of readdirSync(directory).sort()) {
      const candidate = join(directory, name);
      if (!isContained(root, candidate)) throw httpError(400, "workspace path escaped its root");
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        visit(candidate);
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > BACKUP_MAX_FILE_BYTES) continue;
      const relativePath = relative(root, candidate).split(sep).join("/");
      validateArchivePath(`payload/workspaces/x/${relativePath}`);
      const canonical = realpathSync(candidate);
      if (!isContained(canonicalRoot, canonical)) throw httpError(409, "agent workspace file escaped managed storage");
      let fd: number | null = null;
      try {
        fd = openSync(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.size !== stat.size || opened.dev !== stat.dev || opened.ino !== stat.ino || realpathSync(candidate) !== canonical) {
          throw httpError(409, "agent workspace file changed while opening");
        }
        const bytes = readFileSync(fd);
        if (bytes.length !== opened.size || realpathSync(candidate) !== canonical) throw httpError(409, "agent workspace file changed while reading");
        result.push({ relativePath, bytes });
      } finally {
        if (fd !== null) closeSync(fd);
      }
      if (result.length > BACKUP_MAX_FILES) throw httpError(413, "workspace contains too many files");
    }
    if (realpathSync(directory) !== canonicalDirectory) throw httpError(409, "agent workspace directory changed during export");
  };
  visit(root);
  return result;
}

function validateBots(value: unknown, manifest: BackupManifest): PortableBot[] {
  if (!Array.isArray(value) || value.length > 1_000) throw httpError(400, "backup bot roster is invalid");
  const bots = value.map((row) => {
    if (!isPlainRecord(row)) throw httpError(400, "backup bot record is invalid");
    return { ...row, id: safeId(row.id, BOT_ID, "bot id"), threadId: safeId(row.threadId, THREAD_ID, "thread id") } as PortableBot;
  });
  if (new Set(bots.map((bot) => bot.id)).size !== bots.length || new Set(bots.map((bot) => bot.threadId)).size !== bots.length) {
    throw httpError(400, "backup contains duplicate bot or thread ids");
  }
  const ids = new Set(bots.map((bot) => bot.id));
  if (manifest.scope.botIds.length !== ids.size || manifest.scope.botIds.some((id) => !ids.has(id))) {
    throw httpError(400, "backup scope does not match its bot roster");
  }
  if (manifest.scope.kind === "agent" && bots.length !== 1) throw httpError(400, "agent backup must contain exactly one bot");
  for (const bot of bots) {
    if (Object.prototype.hasOwnProperty.call(bot, "approvalPolicy")) {
      if (bot.approvalPolicy !== "ask") {
        // Portable archives never legitimately carried allow/deny authority;
        // accepting it would turn a crafted archive into a privilege import.
        throw httpError(400, "backup agent carries non-portable approval authority");
      }
      // Older archives may contain a global choice. It cannot be translated
      // to scoped authority safely, so restore it as no grants.
      delete bot.approvalPolicy;
    }
    if (
      bot.busy !== false || bot.memoryWriteEnabled !== false ||
      !isPlainRecord(bot.resumeCursors) || Object.keys(bot.resumeCursors).length !== 0 ||
      Object.prototype.hasOwnProperty.call(bot, "mcpServerIds")
    ) throw httpError(400, "backup agent carries non-portable runtime authority");
    if (bot.skillAssignments !== undefined) {
      if (manifest.scope.kind !== "full" || !Array.isArray(bot.skillAssignments) || bot.skillAssignments.length > SKILL_MAX_ASSIGNMENTS) {
        throw httpError(400, "backup agent skill assignments are invalid");
      }
      const assignments = bot.skillAssignments.map((assignment) => validateSkillAssignment(assignment));
      if (new Set(assignments.map((assignment) => assignment.id)).size !== assignments.length) throw httpError(400, "backup agent skill assignments are duplicated");
      bot.skillAssignments = assignments;
    }
    validatePortableBotShape(bot);
  }
  return bots;
}

function validateWorkspace(value: unknown, bots: PortableBot[], files: Map<string, Buffer>): PortableWorkspace {
  if (!isPlainRecord(value)) throw httpError(400, "backup workspace is invalid");
  const required = ["sections", "attachments", "tasks", "runs", "routines"] as const;
  if (required.some((key) => !Array.isArray(value[key]))) throw httpError(400, "backup workspace collections are invalid");
  const workspace = value as unknown as PortableWorkspace;
  const botIds = new Set(bots.map((bot) => bot.id));
  const threads = new Map(bots.map((bot) => [bot.id, bot.threadId]));
  validateJsonBounds(workspace, "workspace");
  if (workspace.sections.length > 1_000) throw httpError(400, "too many section records");
  const sectionIds = new Set<string>();
  for (const section of workspace.sections) {
    if (!isPlainRecord(section)) throw httpError(400, "section record is invalid");
    const id = safeId(section.id, BOT_ID, "section id");
    if (sectionIds.has(id)) throw httpError(400, "workspace contains duplicate sections");
    sectionIds.add(id);
    boundedString(section.name, "section name", 500, false);
    safeTimestamp(section.createdAt, "section creation timestamp");
  }
  if (workspace.attachments.length > BACKUP_MAX_FILES) throw httpError(400, "too many attachment records");
  const attachmentIds = new Set<string>();
  const attachmentBytes = new Map<string, number>();
  for (const row of workspace.attachments) {
    if (!isPlainRecord(row)) throw httpError(400, "invalid attachment record");
    const id = safeId(row.id, BOT_ID, "attachment id");
    const botId = safeId(row.botId, BOT_ID, "attachment bot id");
    const threadId = safeId(row.threadId, THREAD_ID, "attachment thread id");
    if (!botIds.has(botId) || threads.get(botId) !== threadId || attachmentIds.has(id)) throw httpError(400, "attachment ownership is invalid");
    const size = Number(row.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > BACKUP_MAX_FILE_BYTES) throw httpError(400, "attachment size is invalid");
    boundedString(row.name, "attachment name", 1_000, false);
    boundedString(row.mime, "attachment MIME type", 240, false);
    safeTimestamp(row.createdAt, "attachment creation timestamp");
    const path = `payload/attachments/${id}`;
    const bytes = files.get(path);
    if (!bytes || bytes.length !== size || row.storedPath !== `attachments/${id}`) throw httpError(400, "attachment payload is missing or inconsistent");
    attachmentIds.add(id);
    attachmentBytes.set(botId, (attachmentBytes.get(botId) ?? 0) + size);
  }
  if ([...attachmentBytes.values()].some((bytes) => bytes > 250 * 1024 * 1024)) throw httpError(413, "per-agent attachment quota exceeded");
  const validateOwnedRows = (rows: Array<Record<string, unknown>>, label: string) => {
    const ids = new Set<string>();
    if (rows.length > 1_000) throw httpError(400, `too many ${label} records`);
    for (const row of rows) {
      if (!isPlainRecord(row) || typeof row.id !== "string" || !BOT_ID.test(row.id) || ids.has(row.id) || typeof row.botId !== "string" || !botIds.has(row.botId)) {
        throw httpError(400, `${label} ownership or identity is invalid`);
      }
      ids.add(row.id);
    }
    return ids;
  };
  const taskIds = validateOwnedRows(workspace.tasks, "task");
  const runIds = validateOwnedRows(workspace.runs, "run");
  const routineIds = validateOwnedRows(workspace.routines, "routine");
  const taskRequirementIds = new Map<string, Set<string>>();
  for (const task of workspace.tasks) {
    if (
      !["message", "routine", "handoff"].includes(String(task.source)) ||
      !["queued", "running", "needs_attention", "interrupted", "completed", "failed", "cancelled"].includes(String(task.status)) ||
      !Array.isArray(task.attachmentIds) || task.attachmentIds.some((id) => typeof id !== "string" || !attachmentIds.has(id)) ||
      (task.routineId !== undefined && (typeof task.routineId !== "string" || !routineIds.has(task.routineId))) ||
      (task.latestRunId !== undefined && (typeof task.latestRunId !== "string" || !runIds.has(task.latestRunId))) ||
      typeof task.prompt !== "string" || typeof task.title !== "string"
    ) throw httpError(400, "task schema or relationships are invalid");
    boundedString(task.title, "task title", 1_000, false);
    boundedString(task.prompt, "task prompt", 20_000, false);
    safeTimestamp(task.createdAt, "task creation timestamp");
    safeTimestamp(task.updatedAt, "task update timestamp");
    if (task.scheduledFor !== undefined) safeTimestamp(task.scheduledFor, "task schedule timestamp");
    if (task.budget !== undefined) {
      try { parseTaskBudget(task.budget); } catch { throw httpError(400, "task budget is invalid"); }
    }
    if (task.budgetDurationUsedMs !== undefined && (!Number.isSafeInteger(task.budgetDurationUsedMs) || Number(task.budgetDurationUsedMs) < 0 || Number(task.budgetDurationUsedMs) > 1_000_000_000_000)) throw httpError(400, "task budget duration usage is invalid");
    const requirements = task.evidenceRequirements === undefined ? [] : task.evidenceRequirements;
    if (!Array.isArray(requirements) || requirements.length > 20) throw httpError(400, "task evidence requirements are invalid");
    const requirementIds = new Set<string>();
    for (const requirement of requirements) {
      if (!isPlainRecord(requirement) || typeof requirement.id !== "string" || !BOT_ID.test(requirement.id) || requirementIds.has(requirement.id)) {
        throw httpError(400, "task evidence requirement identity is invalid");
      }
      boundedString(requirement.label, "task evidence requirement", 500, false);
      safeTimestamp(requirement.createdAt, "task evidence requirement timestamp");
      requirementIds.add(requirement.id);
    }
    taskRequirementIds.set(String(task.id), requirementIds);
  }
  const portableEffectById = new Map<string, { taskId: string; botId: string; fingerprint: string; attempt: number; createdAt: number }>();
  const portableEffectRetries: Array<{ id: string; retryOf: string }> = [];
  for (const run of workspace.runs) {
    const task = workspace.tasks.find((candidate) => candidate.id === run.taskId);
    if (
      typeof run.taskId !== "string" || !taskIds.has(run.taskId) || task?.botId !== run.botId ||
      !["running", "needs_attention", "interrupted", "completed", "failed", "cancelled"].includes(String(run.status)) ||
      !Array.isArray(run.steps) || !Array.isArray(run.artifacts) ||
      (run.routineId !== undefined && (typeof run.routineId !== "string" || !routineIds.has(run.routineId)))
    ) throw httpError(400, "run schema or relationships are invalid");
    safeTimestamp(run.startedAt, "run start timestamp");
    if (run.completedAt !== undefined) safeTimestamp(run.completedAt, "run completion timestamp");
    if (run.error !== undefined) boundedString(run.error, "run error", 20_000);
    if (run.attempt !== undefined && (!Number.isSafeInteger(run.attempt) || Number(run.attempt) < 1 || Number(run.attempt) > 10_000)) throw httpError(400, "run attempt is invalid");
    if (run.resumeStatus !== undefined && !["available", "unsafe", "resumed"].includes(String(run.resumeStatus))) throw httpError(400, "run resume status is invalid");
    if (run.resumeUnsafeReason !== undefined && !["turn_not_accepted", "unknown_effect", "missing_transcript", "branch_mismatch", "provider_unavailable"].includes(String(run.resumeUnsafeReason))) throw httpError(400, "run resume reason is invalid");
    if (run.checkpoint !== undefined && !validRunCheckpoint(run.checkpoint, { id: String(run.id), taskId: String(run.taskId), botId: String(run.botId) })) throw httpError(400, "run checkpoint is invalid");
    const checkpoint = isPlainRecord(run.checkpoint) ? run.checkpoint : undefined;
    if (
      (run.resumeStatus === "available" && checkpoint?.status !== "available") ||
      (run.resumeStatus === "resumed" && checkpoint?.status !== "consumed") ||
      (run.resumeStatus === "unsafe" && run.resumeUnsafeReason === undefined) ||
      (checkpoint?.status === "available" && run.resumeStatus !== "available") ||
      (checkpoint?.status === "unsafe" && (run.resumeStatus !== "unsafe" || run.resumeUnsafeReason !== checkpoint.unsafeReason)) ||
      (checkpoint?.status === "consumed" && run.resumeStatus !== "resumed")
    ) throw httpError(400, "run checkpoint state is inconsistent");
    for (const key of ["resumeOfRunId", "resumedFromCheckpointId"] as const) {
      if (run[key] !== undefined && (typeof run[key] !== "string" || !BOT_ID.test(run[key]))) throw httpError(400, `run ${key} is invalid`);
    }
    const taskBudget = task?.budget === undefined ? undefined : parseTaskBudget(task.budget);
    if (Boolean(taskBudget) !== Boolean(run.budgetUsage)) throw httpError(400, "run budget linkage is inconsistent");
    if (run.budgetUsage !== undefined) {
      const usage = run.budgetUsage;
      if (!validTaskBudgetUsage(usage)) throw httpError(400, "run budget usage is invalid");
      if (usage.activeSince !== undefined && run.status !== "running") throw httpError(400, "inactive run has an active budget interval");
      if (usage.exhaustionReason && taskBudget?.[usage.exhaustionReason] === undefined) throw httpError(400, "run exhausted an unconfigured budget metric");
      const allowedUsageKeys = new Set(["startedAt", "activeSince", "durationUsedMs", "toolCalls", "computerActions", "delegations", "tokens", "tokenBaseline", "tokenLatest", "exhaustedAt", "exhaustionReason"]);
      if (Object.keys(usage).some((key) => !allowedUsageKeys.has(key))) throw httpError(400, "run budget usage contains unknown fields");
      safeTimestamp(usage.startedAt, "run budget start timestamp");
      if (!Number.isSafeInteger(usage.durationUsedMs) || Number(usage.durationUsedMs) < 0 || Number(usage.durationUsedMs) > 1_000_000_000_000) throw httpError(400, "run budget duration usage is invalid");
      if (usage.activeSince !== undefined) {
        safeTimestamp(usage.activeSince, "run budget active timestamp");
        if (Number(usage.activeSince) < Number(usage.startedAt) || usage.exhaustedAt !== undefined) throw httpError(400, "run budget active interval is invalid");
      }
      for (const key of ["toolCalls", "computerActions", "delegations"] as const) {
        if (!Number.isSafeInteger(usage[key]) || Number(usage[key]) < 0 || Number(usage[key]) > 100_000_000) throw httpError(400, "run budget usage is invalid");
      }
      if (usage.tokens !== undefined && (!Number.isSafeInteger(usage.tokens) || Number(usage.tokens) < 0 || Number(usage.tokens) > 1_000_000_000)) throw httpError(400, "run token usage is invalid");
      if ((usage.exhaustionReason === undefined) !== (usage.exhaustedAt === undefined)) throw httpError(400, "run budget exhaustion marker is inconsistent");
      if (usage.exhaustionReason !== undefined && !["durationMs", "toolCalls", "computerActions", "delegations", "tokens"].includes(String(usage.exhaustionReason))) throw httpError(400, "run budget exhaustion reason is invalid");
      if (usage.exhaustedAt !== undefined) {
        safeTimestamp(usage.exhaustedAt, "run budget exhaustion timestamp");
        if (Number(usage.exhaustedAt) < Number(usage.startedAt)) throw httpError(400, "run budget exhaustion timestamp is invalid");
      }
      for (const key of ["tokenBaseline", "tokenLatest"] as const) {
        const snapshot = usage[key];
        if (snapshot !== undefined && (!isPlainRecord(snapshot) || Object.keys(snapshot).some((field) => !["providerInstanceId", "model", "input", "output"].includes(field)) || Object.keys(snapshot).length !== 4 || typeof snapshot.providerInstanceId !== "string" || !/^[\w.-]{1,100}$/.test(snapshot.providerInstanceId) || typeof snapshot.model !== "string" || !snapshot.model || snapshot.model.length > 200 || !Number.isSafeInteger(snapshot.input) || Number(snapshot.input) < 0 || Number(snapshot.input) > 1_000_000_000 || !Number.isSafeInteger(snapshot.output) || Number(snapshot.output) < 0 || Number(snapshot.output) > 1_000_000_000)) throw httpError(400, `run ${key} is invalid`);
      }
    }
    if (run.steps.length > 2_000 || run.artifacts.length > 2_000) throw httpError(400, "run history is too large");
    for (const step of run.steps) {
      if (!isPlainRecord(step) || !["tool", "approval", "handoff"].includes(String(step.kind)) || !["running", "needs_attention", "completed", "failed", "denied"].includes(String(step.status))) throw httpError(400, "run step is invalid");
      safeId(step.id, BOT_ID, "run step id");
      boundedString(step.title, "run step title", 2_000, false);
      safeTimestamp(step.startedAt, "run step timestamp");
      if (step.completedAt !== undefined) safeTimestamp(step.completedAt, "run step completion timestamp");
    }
    for (const artifact of run.artifacts) {
      if (!isPlainRecord(artifact) || !["attachment", "response", "screen"].includes(String(artifact.kind))) throw httpError(400, "run artifact is invalid");
      safeId(artifact.id, BOT_ID, "run artifact id");
      boundedString(artifact.label, "run artifact label", 2_000, false);
      safeTimestamp(artifact.createdAt, "run artifact timestamp");
    }
    const evidence = run.evidence === undefined ? [] : run.evidence;
    if (!Array.isArray(evidence) || evidence.length > 200) throw httpError(400, "run evidence is invalid");
    const evidenceIds = new Set<string>();
    for (const record of evidence) {
      if (
        !isPlainRecord(record) || typeof record.id !== "string" || !BOT_ID.test(record.id) || evidenceIds.has(record.id) ||
        typeof record.requirementId !== "string" || !taskRequirementIds.get(String(run.taskId))?.has(record.requirementId) ||
        !["claimed", "observed", "verified", "rejected"].includes(String(record.level)) ||
        !["user", "system", "verifier"].includes(String(record.source)) ||
        (record.level === "verified" && record.source !== "verifier")
      ) throw httpError(400, "run evidence record is invalid");
      boundedString(record.label, "run evidence label", 500, false);
      safeTimestamp(record.recordedAt, "run evidence timestamp");
      if (record.digest !== undefined && (typeof record.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.digest))) {
        throw httpError(400, "run evidence digest is invalid");
      }
      if (record.reference !== undefined) {
        if (!isPlainRecord(record.reference) || record.reference.runId !== run.id || !["step", "artifact"].includes(String(record.reference.kind)) || typeof record.reference.id !== "string") {
          throw httpError(400, "run evidence reference is invalid");
        }
        const targets = record.reference.kind === "step" ? run.steps : run.artifacts;
        const referenceId = record.reference.id;
        if (!targets.some((target) => isPlainRecord(target) && target.id === referenceId)) throw httpError(400, "run evidence target is missing");
      }
      if (record.level === "observed" && (record.reference === undefined || record.digest === undefined)) {
        throw httpError(400, "observed evidence requires a canonical reference and digest");
      }
      if (record.level === "verified") {
        if (!isPlainRecord(record.verifier)) throw httpError(400, "run evidence verifier is missing");
        boundedString(record.verifier.id, "run evidence verifier", 500, false);
        boundedString(record.verifier.version, "run evidence verifier version", 500, false);
        if (record.reference === undefined || record.digest === undefined) throw httpError(400, "verified evidence requires a canonical reference and digest");
      }
      evidenceIds.add(record.id);
    }
    if (run.compaction !== undefined) {
      const value = run.compaction;
      if (
        !isPlainRecord(value) || Object.keys(value).some((key) => !["policyVersion", "compacted", "originalMessages", "submittedMessages", "originalBytes", "submittedBytes", "omittedMessages", "estimatedSubmittedTokens", "selectedIdentityDigest"].includes(key)) ||
        value.policyVersion !== 1 || typeof value.compacted !== "boolean" ||
        ![value.originalMessages, value.submittedMessages, value.originalBytes, value.submittedBytes, value.omittedMessages, value.estimatedSubmittedTokens].every((number) => Number.isSafeInteger(number) && Number(number) >= 0) ||
        Number(value.submittedMessages) > Number(value.originalMessages) ||
        Number(value.omittedMessages) !== Number(value.originalMessages) - Number(value.submittedMessages) ||
        typeof value.selectedIdentityDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.selectedIdentityDigest)
      ) throw httpError(400, "run context-compaction statistics are invalid");
    }
    const effects = run.effects === undefined ? [] : run.effects;
    if (!Array.isArray(effects) || effects.length > 500) throw httpError(400, "run external-effect receipts are invalid");
    const effectIds = new Set(effects.flatMap((effect) => isPlainRecord(effect) && typeof effect.id === "string" ? [effect.id] : []));
    if (effectIds.size !== effects.length) throw httpError(400, "run external-effect receipt identities are invalid");
    const allowedEffectKeys = new Set([
      "id", "runId", "taskId", "botId", "stepId", "itemId", "origin", "descriptor", "requestHash",
      "idempotencyKey", "fingerprint", "attempt", "retryOf", "state", "result", "audit", "createdAt", "updatedAt",
    ]);
    for (const effect of effects) {
      if (
        !isPlainRecord(effect) || Object.keys(effect).some((key) => !allowedEffectKeys.has(key)) ||
        effect.runId !== run.id || effect.taskId !== run.taskId || effect.botId !== run.botId ||
        !["controlled", "provider_observation"].includes(String(effect.origin)) ||
        !["intended", "applying", "applied", "failed", "unknown"].includes(String(effect.state)) ||
        typeof effect.id !== "string" || !/^effect-[\w-]{1,100}$/.test(effect.id) ||
        typeof effect.requestHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(effect.requestHash) ||
        typeof effect.idempotencyKey !== "string" || !/^sha256:[a-f0-9]{64}$/.test(effect.idempotencyKey) ||
        typeof effect.fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(effect.fingerprint) ||
        !Number.isSafeInteger(effect.attempt) || Number(effect.attempt) < 1 || Number(effect.attempt) > 10_000 ||
        (effect.retryOf !== undefined && typeof effect.retryOf !== "string") ||
        (effect.stepId !== undefined && (typeof effect.stepId !== "string" || !run.steps.some((step) => isPlainRecord(step) && step.id === effect.stepId))) ||
        (effect.itemId !== undefined && (typeof effect.itemId !== "string" || effect.itemId.length > 200)) ||
        !isPlainRecord(effect.descriptor) || Object.keys(effect.descriptor).some((key) => !["boundary", "action", "targetHint"].includes(key)) ||
        typeof effect.descriptor.boundary !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(effect.descriptor.boundary) ||
        typeof effect.descriptor.action !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(effect.descriptor.action) ||
        (effect.descriptor.targetHint !== undefined && (typeof effect.descriptor.targetHint !== "string" || effect.descriptor.targetHint.length > 100 || /bearer\s+|token|password|secret|api[_-]?key|https?:\/\/|@|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\bxox[baprs]-[A-Za-z0-9-]{16,}/i.test(effect.descriptor.targetHint))) ||
        !Array.isArray(effect.audit) || effect.audit.length < 1 || effect.audit.length > 100
      ) throw httpError(400, "run external-effect receipt is invalid");
      safeTimestamp(effect.createdAt, "external-effect creation timestamp");
      safeTimestamp(effect.updatedAt, "external-effect update timestamp");
      const auditIds = new Set<string>();
      for (const audit of effect.audit) {
        if (
          !isPlainRecord(audit) || Object.keys(audit).some((key) => !["id", "event", "at", "note"].includes(key)) ||
          typeof audit.id !== "string" || !/^effect-audit-[\w-]{1,100}$/.test(audit.id) || auditIds.has(audit.id) ||
          !["intended", "applying", "applied", "failed", "restart_unknown", "ambiguous_unknown", "duplicate", "observed_unknown", "user_resolved"].includes(String(audit.event)) ||
          (audit.note !== undefined && (typeof audit.note !== "string" || audit.note.length > 160 || /bearer\s+|token|password|secret|api[_-]?key|https?:\/\/|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\bxox[baprs]-[A-Za-z0-9-]{16,}/i.test(audit.note)))
        ) throw httpError(400, "external-effect audit record is invalid");
        safeTimestamp(audit.at, "external-effect audit timestamp");
        auditIds.add(audit.id);
      }
      if (effect.result !== undefined) {
        if (
          !isPlainRecord(effect.result) || Object.keys(effect.result).some((key) => !["ok", "kind", "code", "reference", "digest"].includes(key)) ||
          typeof effect.result.ok !== "boolean" || typeof effect.result.kind !== "string" || effect.result.kind.length > 20 ||
          typeof effect.result.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(effect.result.digest) ||
          (effect.result.code !== undefined && (typeof effect.result.code !== "string" || effect.result.code.length > 40)) ||
          (effect.result.reference !== undefined && (typeof effect.result.reference !== "string" || effect.result.reference.length > 100 || /bearer\s+|token|password|secret|https?:\/\/|@|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\bxox[baprs]-[A-Za-z0-9-]{16,}/i.test(effect.result.reference)))
        ) throw httpError(400, "external-effect result metadata is invalid");
      }
      if ((effect.state === "applied" || effect.state === "failed") && effect.result === undefined) {
        throw httpError(400, "external-effect result is missing");
      }
      if ((effect.state === "intended" || effect.state === "applying") && effect.result !== undefined) {
        throw httpError(400, "external-effect result does not match its state");
      }
      if (portableEffectById.has(String(effect.id))) throw httpError(400, "external-effect identity is duplicated");
      portableEffectById.set(String(effect.id), {
        taskId: String(effect.taskId),
        botId: String(effect.botId),
        fingerprint: String(effect.fingerprint),
        attempt: Number(effect.attempt),
        createdAt: Number(effect.createdAt),
      });
      if (typeof effect.retryOf === "string") portableEffectRetries.push({ id: String(effect.id), retryOf: effect.retryOf });
    }
  }
  const runsById = new Map(workspace.runs.map((run) => [String(run.id), run]));
  for (const run of workspace.runs) {
    if (run.resumeOfRunId === undefined && run.resumedFromCheckpointId === undefined) continue;
    const previous = typeof run.resumeOfRunId === "string" ? runsById.get(run.resumeOfRunId) : undefined;
    if (
      !previous || previous.taskId !== run.taskId || previous.botId !== run.botId ||
      !isPlainRecord(previous.checkpoint) || previous.checkpoint.status !== "consumed" ||
      previous.checkpoint.id !== run.resumedFromCheckpointId || previous.checkpoint.resumedByRunId !== run.id ||
      !Number.isSafeInteger(run.attempt) || Number(run.attempt) !== Number(previous.attempt ?? 1) + 1 ||
      Number(previous.startedAt) > Number(run.startedAt)
    ) throw httpError(400, "run checkpoint linkage is invalid");
  }
  for (const retry of portableEffectRetries) {
    const current = portableEffectById.get(retry.id)!;
    const previous = portableEffectById.get(retry.retryOf);
    if (
      !previous || previous.taskId !== current.taskId || previous.botId !== current.botId ||
      previous.fingerprint !== current.fingerprint || previous.attempt + 1 !== current.attempt ||
      previous.createdAt > current.createdAt
    ) throw httpError(400, "external-effect retry relationship is invalid");
  }
  const portableEffectAttemptKeys = new Set<string>();
  for (const [id, effect] of portableEffectById) {
    const retry = portableEffectRetries.find((candidate) => candidate.id === id);
    if ((effect.attempt === 1 && retry) || (effect.attempt > 1 && !retry)) {
      throw httpError(400, "external-effect attempt chain is invalid");
    }
    const key = `${effect.taskId}\0${effect.botId}\0${effect.fingerprint}\0${effect.attempt}`;
    if (portableEffectAttemptKeys.has(key)) throw httpError(400, "external-effect attempt is duplicated");
    portableEffectAttemptKeys.add(key);
  }
  for (const routine of workspace.routines) {
    if (
      typeof routine.name !== "string" || typeof routine.prompt !== "string" || typeof routine.enabled !== "boolean" ||
      (routine.nextRunAt !== null && !Number.isFinite(routine.nextRunAt)) ||
      (routine.catchUpPolicy !== undefined && !["latest", "skip"].includes(String(routine.catchUpPolicy)))
    ) throw httpError(400, "routine schema is invalid");
    boundedString(routine.name, "routine name", 100, false);
    boundedString(routine.prompt, "routine prompt", 20_000, false);
    safeTimestamp(routine.createdAt, "routine creation timestamp");
    safeTimestamp(routine.updatedAt, "routine update timestamp");
    if (routine.lastRunAt !== undefined) safeTimestamp(routine.lastRunAt, "routine last-run timestamp");
    if (routine.lastScheduledFor !== undefined) safeTimestamp(routine.lastScheduledFor, "routine scheduled timestamp");
    if (routine.lastError !== undefined) boundedString(routine.lastError, "routine error", 20_000);
    try {
      validateSchedule(routine.schedule as never);
    } catch {
      throw httpError(400, "routine schedule is invalid");
    }
  }
  return workspace;
}

function validatePayloadInventory(files: Map<string, Buffer>, bots: PortableBot[], workspace: PortableWorkspace, scope: BackupManifest["scope"]): void {
  const botIds = new Set(bots.map((bot) => bot.id));
  const threadIds = new Set(bots.map((bot) => bot.threadId));
  const attachmentIds = new Set(workspace.attachments.map((attachment) => attachment.id));
  for (const path of files.keys()) {
    if (path === "payload/bots.json" || path === "payload/workspace.json") continue;
    if (path === "payload/profile.json") {
      if (scope.kind !== "full") throw httpError(400, "agent backup cannot contain a host profile");
      continue;
    }
    if (/^payload\/skills\/[a-z0-9][a-z0-9-]{0,63}\/[0-9A-Za-z.+-]+\/(?:manifest\.json|instructions\.md)$/.test(path)) {
      if (scope.kind !== "full") throw httpError(400, "agent backup cannot contain local skill packages");
      continue;
    }
    let match = path.match(/^payload\/attachments\/([A-Za-z0-9_-]+)$/);
    if (match) {
      if (!attachmentIds.has(match[1])) throw httpError(400, "backup contains an unowned attachment payload");
      continue;
    }
    match = path.match(/^payload\/messages\/([A-Za-z0-9_-]+)\.json$/);
    if (match) {
      if (!threadIds.has(match[1])) throw httpError(400, "backup contains an unowned transcript");
      continue;
    }
    match = path.match(/^payload\/memory\/([A-Za-z0-9_-]+)\.json$/);
    if (match) {
      if (!botIds.has(match[1])) throw httpError(400, "backup contains unowned memory");
      continue;
    }
    match = path.match(/^payload\/workspaces\/([A-Za-z0-9_-]+)\/(.+)$/);
    if (match) {
      if (!botIds.has(match[1])) throw httpError(400, "backup contains an unowned workspace file");
      continue;
    }
    throw httpError(400, `backup contains unsupported payload ${path}`);
  }
}

function validateSkillPayloads(files: Map<string, Buffer>, scope: BackupManifest["scope"]): Set<string> {
  const versions = new Map<string, { manifest?: Buffer; instructions?: Buffer }>();
  for (const [path, bytes] of files) {
    const match = path.match(/^payload\/skills\/([a-z0-9][a-z0-9-]{0,63})\/([0-9A-Za-z.+-]+)\/(manifest\.json|instructions\.md)$/);
    if (!match) continue;
    if (scope.kind !== "full") throw httpError(400, "agent backup cannot contain local skill packages");
    const key = `${match[1]}@${match[2]}`;
    const row = versions.get(key) ?? {};
    if (match[3] === "manifest.json") row.manifest = bytes;
    else row.instructions = bytes;
    versions.set(key, row);
  }
  const packageIds = new Set([...versions.keys()].map((key) => key.split("@")[0]));
  if (packageIds.size > SKILL_MAX_PACKAGES) throw httpError(400, "backup contains too many local skill packages");
  for (const id of packageIds) if ([...versions.keys()].filter((key) => key.startsWith(`${id}@`)).length > SKILL_MAX_VERSIONS) throw httpError(400, "backup local skill history is too large");
  for (const [key, row] of versions) {
    if (!row.manifest || !row.instructions || row.instructions.length === 0 || row.instructions.length > SKILL_MAX_INSTRUCTION_BYTES) throw httpError(400, "backup local skill version is incomplete or oversized");
    let instructions: string;
    try {
      instructions = new TextDecoder("utf-8", { fatal: true }).decode(row.instructions);
    } catch {
      throw httpError(400, "backup local skill instructions are not valid UTF-8");
    }
    const separator = key.lastIndexOf("@");
    validateSkillManifest(parseJson(row.manifest, "local skill manifest"), { id: key.slice(0, separator), version: key.slice(separator + 1), instructions });
  }
  return new Set(versions.keys());
}

function validateProfile(bytes: Buffer | undefined): void {
  if (!bytes) return;
  const value = parseJson(bytes, "profile");
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !["name", "email"].includes(key))) throw httpError(400, "backup profile is invalid");
  for (const [key, limit] of [["name", 120], ["email", 254]] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > limit || /[\u0000-\u001f\u007f]/.test(value[key]))) {
      throw httpError(400, "backup profile is invalid");
    }
  }
}

function uniqueSibling(dataDir: string, label: string): string {
  return join(dirname(dataDir), `.${basename(dataDir)}-${label}-${Date.now()}-${randomBytes(5).toString("hex")}`);
}

function removePortableState(root: string, botIds?: Set<string>): void {
  const remove = (path: string) => rmSync(path, { recursive: true, force: true });
  if (!botIds) {
    remove(join(root, "bots.json"));
    remove(join(root, "workspace.json"));
    remove(join(root, "attachments"));
    remove(join(root, "bot-workspaces"));
    remove(join(root, "events"));
    remove(join(root, "native"));
    remove(join(root, "skills"));
    for (const name of readdirSync(root)) if (/^(?:messages|memory)-[A-Za-z0-9_-]+\.json$/.test(name)) remove(join(root, name));
    return;
  }
  for (const botId of botIds) {
    remove(join(root, `memory-${botId}.json`));
    remove(join(root, "attachments", botId));
    remove(join(root, "bot-workspaces", botId));
  }
}

function mergeById(current: Array<Record<string, unknown>>, incoming: Array<Record<string, unknown>>, botIds: Set<string>) {
  return [...current.filter((row) => typeof row.botId !== "string" || !botIds.has(row.botId)), ...incoming];
}

export class BackupService {
  private readonly dataDir: string;
  private readonly now: () => number;

  constructor(options: BackupOptions) {
    this.dataDir = resolve(options.dataDir);
    this.now = options.now ?? Date.now;
  }

  async export(scope: BackupScope = { kind: "full" }): Promise<{ bytes: Buffer; manifest: BackupManifest }> {
    if (scope.kind === "agent" && !BOT_ID.test(scope.botId)) throw httpError(400, "invalid bot id");
    const secrets = collectKnownSecrets(this.dataDir);
    const rawBots = readJsonStrict(join(this.dataDir, "bots.json"), [], "agent roster");
    if (!Array.isArray(rawBots)) throw httpError(409, "agent roster has an invalid shape");
    const decodedBots = rawBots.map((row) => portableBot(row, secrets, scope));
    if (decodedBots.some((bot) => !bot)) throw httpError(409, "agent roster contains a corrupt record");
    const bots = (decodedBots as PortableBot[]).filter((bot) => scope.kind === "full" || bot.id === scope.botId);
    if (scope.kind === "agent" && bots.length !== 1) throw httpError(404, "no such agent");
    const botIds = new Set(bots.map((bot) => bot.id));
    const rawWorkspaceData = readJsonStrict(join(this.dataDir, "workspace.json"), emptyWorkspace(), "workspace database");
    const workspace = portableWorkspace(rawWorkspaceData, botIds, scope, secrets);
    if (scope.kind === "agent") {
      const sectionIds = new Set(bots.flatMap((bot) => typeof bot.sectionId === "string" ? [bot.sectionId] : []));
      const rawWorkspace = rawWorkspaceData as Record<string, unknown>;
      workspace.sections = (Array.isArray(rawWorkspace.sections) ? rawWorkspace.sections : [])
        .filter((row): row is Record<string, unknown> => isPlainRecord(row) && typeof row.id === "string" && sectionIds.has(row.id));
    }

    const payload = new Map<string, Buffer>();
    payload.set("payload/bots.json", jsonBytes(bots));
    payload.set("payload/workspace.json", jsonBytes(workspace));
    const config = readJsonStrict(join(this.dataDir, "config.json"), {}, "configuration profile");
    if (scope.kind === "full" && isPlainRecord(config) && isPlainRecord(config.profile)) {
      payload.set("payload/profile.json", jsonBytes(redactValue(config.profile, secrets)));
    }
    if (scope.kind === "full" && existsSync(join(this.dataDir, "skills", "packages"))) {
      const skills = new SkillRegistry(this.dataDir);
      for (const manifest of skills.list()) {
        const skill = skills.package(manifest.id, manifest.version);
        if (redactString(skill.instructions, secrets) !== skill.instructions || HIGH_CONFIDENCE_SECRET.test(skill.instructions)) {
          throw httpError(409, `local skill ${manifest.id}@${manifest.version} contains credential-like content and cannot be exported safely`);
        }
        payload.set(`payload/skills/${manifest.id}/${manifest.version}/manifest.json`, jsonBytes(skill.manifest));
        payload.set(`payload/skills/${manifest.id}/${manifest.version}/instructions.md`, Buffer.from(skill.instructions, "utf8"));
      }
    }

    for (const bot of bots) {
      const transcript = join(this.dataDir, `messages-${bot.threadId}.json`);
      const rawTranscript = readJsonStrict(transcript, { messages: [], activeLeafId: null }, `transcript for ${bot.id}`);
      payload.set(`payload/messages/${bot.threadId}.json`, jsonBytes(redactValue(rawTranscript, secrets)));
      const memoryPath = join(this.dataDir, `memory-${bot.id}.json`);
      if (existsSync(memoryPath)) payload.set(`payload/memory/${bot.id}.json`, jsonBytes(redactValue(readJsonStrict(memoryPath, {}, `memory for ${bot.id}`), secrets)));
    }

    for (const attachment of workspace.attachments) {
      const rawWorkspace = rawWorkspaceData as Record<string, unknown>;
      const source = (Array.isArray(rawWorkspace.attachments) ? rawWorkspace.attachments : [])
        .find((row) => isPlainRecord(row) && row.id === attachment.id) as Record<string, unknown> | undefined;
      if (!source || typeof source.storedPath !== "string") throw httpError(409, `attachment ${attachment.id} is missing`);
      payload.set(`payload/attachments/${attachment.id}`, readManagedAttachment(this.dataDir, attachment.botId, source.storedPath, attachment.size));
    }

    let skippedWorkspaceFiles = 0;
    for (const bot of bots) {
      const root = join(this.dataDir, "bot-workspaces", bot.id);
      for (const file of walkRegularFiles(root)) {
        if (!workspaceFileLooksSafe(file.relativePath, file.bytes, secrets)) {
          skippedWorkspaceFiles += 1;
          continue;
        }
        payload.set(`payload/workspaces/${bot.id}/${file.relativePath}`, file.bytes);
      }
    }
    if (payload.size > BACKUP_MAX_FILES) throw httpError(413, "backup contains too many files");
    const expandedBytes = [...payload.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    if (expandedBytes > BACKUP_MAX_EXPANDED_BYTES) throw httpError(413, "backup exceeds the expanded size limit");

    const files = [...payload.entries()].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) }));
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      dataSchemaVersion: CUMEA_DATA_SCHEMA_VERSION,
      createdAt: new Date(this.now()).toISOString(),
      scope: { kind: scope.kind, botIds: [...botIds].sort() },
      files,
      exclusions: [
        "provider credentials and resume cursors",
        "MCP environment values and executable registry",
        "remembered approval rules and legacy approval policy",
        "paired devices, pairing sessions and push tokens",
        "browser and provider sessions",
        "native runtime state and event logs",
      ],
      skippedWorkspaceFiles,
    };
    const zip = new JSZip();
    zip.file("manifest.json", jsonBytes(manifest));
    for (const [path, bytes] of payload) zip.file(path, bytes);
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    if (bytes.length > BACKUP_MAX_ARCHIVE_BYTES) throw httpError(413, "compressed backup exceeds the upload limit");
    // Export and import intentionally share one acceptance boundary. This
    // prevents a download from claiming completeness when a syntactically
    // valid local record cannot be safely consumed after restore.
    try {
      await this.inspect(bytes);
    } catch (error) {
      throw httpError(409, "local data cannot be represented as a valid portable backup", error);
    }
    return { bytes, manifest };
  }

  async inspect(bytes: Buffer): Promise<ValidatedArchive> {
    if (!bytes.length || bytes.length > BACKUP_MAX_ARCHIVE_BYTES) throw httpError(413, "backup archive is empty or too large");
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
    } catch (error) {
      throw httpError(400, "backup archive is corrupt", error);
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (!entries.length || entries.length > BACKUP_MAX_FILES + 1) throw httpError(400, "backup file count is invalid");
    const names = new Set<string>();
    for (const entry of entries) {
      const original = (entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
      if (original !== entry.name) throw httpError(400, "backup contains a normalized unsafe path");
      const name = validateArchivePath(entry.name);
      if (names.has(name)) throw httpError(400, "backup contains duplicate paths");
      names.add(name);
    }
    const manifestEntry = zip.file("manifest.json");
    if (!manifestEntry) throw httpError(400, "backup manifest is missing");
    const manifestDeclaredBytes = Number((manifestEntry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize);
    if (!Number.isSafeInteger(manifestDeclaredBytes) || manifestDeclaredBytes < 1 || manifestDeclaredBytes > BACKUP_MAX_FILE_BYTES) {
      throw httpError(413, "backup manifest expanded size is invalid");
    }
    const manifestBytes = Buffer.from(await manifestEntry.async("nodebuffer"));
    const rawManifest = parseJson(manifestBytes, "backup manifest");
    if (!isPlainRecord(rawManifest) || rawManifest.format !== BACKUP_FORMAT) throw httpError(400, "not a Cumea backup");
    if (rawManifest.formatVersion !== BACKUP_FORMAT_VERSION) throw httpError(409, "backup format version is not supported");
    if (typeof rawManifest.dataSchemaVersion !== "number" || rawManifest.dataSchemaVersion > CUMEA_DATA_SCHEMA_VERSION) {
      throw httpError(409, "backup was created by a newer Cumea data schema");
    }
    if (rawManifest.dataSchemaVersion !== CUMEA_DATA_SCHEMA_VERSION) throw httpError(409, "backup data schema needs an unavailable migration");
    if (!isPlainRecord(rawManifest.scope) || !["full", "agent"].includes(String(rawManifest.scope.kind)) || !Array.isArray(rawManifest.scope.botIds)) {
      throw httpError(400, "backup scope is invalid");
    }
    if (
      rawManifest.scope.botIds.length > 1_000 ||
      rawManifest.scope.botIds.some((id) => typeof id !== "string" || !BOT_ID.test(id)) ||
      new Set(rawManifest.scope.botIds).size !== rawManifest.scope.botIds.length ||
      typeof rawManifest.createdAt !== "string" || !Number.isFinite(Date.parse(rawManifest.createdAt)) ||
      !Number.isSafeInteger(rawManifest.skippedWorkspaceFiles) || Number(rawManifest.skippedWorkspaceFiles) < 0
    ) throw httpError(400, "backup manifest metadata is invalid");
    if (!Array.isArray(rawManifest.files) || rawManifest.files.length > BACKUP_MAX_FILES || !Array.isArray(rawManifest.exclusions)) {
      throw httpError(400, "backup manifest inventory is invalid");
    }
    if (rawManifest.exclusions.length > 100 || rawManifest.exclusions.some((value) => typeof value !== "string" || value.length > 240)) {
      throw httpError(400, "backup exclusion metadata is invalid");
    }
    const manifest = rawManifest as unknown as BackupManifest;
    const inventory = new Map<string, BackupManifestFile>();
    let declaredTotal = 0;
    for (const row of manifest.files) {
      if (!isPlainRecord(row)) throw httpError(400, "backup inventory row is invalid");
      const path = validateArchivePath(String(row.path));
      if (path === "manifest.json" || inventory.has(path) || !Number.isSafeInteger(row.bytes) || Number(row.bytes) < 0 || Number(row.bytes) > BACKUP_MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(String(row.sha256))) {
        throw httpError(400, "backup inventory row is invalid");
      }
      declaredTotal += Number(row.bytes);
      if (!Number.isSafeInteger(declaredTotal) || declaredTotal > BACKUP_MAX_EXPANDED_BYTES) throw httpError(413, "backup expanded size exceeds the limit");
      inventory.set(path, row as unknown as BackupManifestFile);
    }
    if (entries.length !== inventory.size + 1 || [...names].some((name) => name !== "manifest.json" && !inventory.has(name))) {
      throw httpError(400, "backup inventory does not cover every payload file");
    }
    const files = new Map<string, Buffer>();
    let expandedBytes = 0;
    for (const [path, expected] of inventory) {
      const entry = zip.file(path);
      if (!entry) throw httpError(400, `backup payload ${path} is missing`);
      const declaredBytes = Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize);
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes !== expected.bytes || declaredBytes > BACKUP_MAX_FILE_BYTES) {
        throw httpError(400, `backup payload ${path} has an invalid expanded size`);
      }
      const file = Buffer.from(await entry.async("nodebuffer"));
      expandedBytes += file.length;
      if (file.length !== expected.bytes || sha256(file) !== expected.sha256) throw httpError(400, `backup payload ${path} failed integrity validation`);
      files.set(path, file);
    }
    const botsFile = files.get("payload/bots.json");
    const workspaceFile = files.get("payload/workspace.json");
    if (!botsFile || !workspaceFile) throw httpError(400, "backup core data is missing");
    const bots = validateBots(parseJson(botsFile, "bot roster"), manifest);
    const workspace = validateWorkspace(parseJson(workspaceFile, "workspace"), bots, files);
    validatePayloadInventory(files, bots, workspace, manifest.scope);
    const skillVersions = validateSkillPayloads(files, manifest.scope);
    for (const bot of bots) {
      for (const assignment of Array.isArray(bot.skillAssignments) ? bot.skillAssignments : []) {
        const decoded = validateSkillAssignment(assignment);
        if (!skillVersions.has(`${decoded.id}@${decoded.version}`)) throw httpError(400, "backup agent references a missing local skill version");
      }
    }
    validateProfile(files.get("payload/profile.json"));
    for (const bot of bots) {
      if (!files.has(`payload/messages/${bot.threadId}.json`)) throw httpError(400, `transcript for ${bot.id} is missing`);
      const transcriptIds = validateTranscript(parseJson(files.get(`payload/messages/${bot.threadId}.json`)!, "transcript"));
      for (const run of workspace.runs.filter((candidate) => candidate.botId === bot.id && isPlainRecord(candidate.checkpoint))) {
        if (!transcriptIds.has(String((run.checkpoint as Record<string, unknown>).activeLeafId))) {
          throw httpError(400, "run checkpoint transcript leaf is missing");
        }
        const task = workspace.tasks.find((candidate) => candidate.id === run.taskId);
        if (!task || typeof task.messageId !== "string" || !transcriptIds.has(task.messageId)) {
          throw httpError(400, "run checkpoint task message is missing");
        }
      }
      const memoryFile = files.get(`payload/memory/${bot.id}.json`);
      if (memoryFile) validateMemory(parseJson(memoryFile, "memory"), bot.id);
    }
    const warnings = manifest.skippedWorkspaceFiles > 0
      ? [`${manifest.skippedWorkspaceFiles} workspace file(s) with credential-like names or contents were excluded.`]
      : [];
    return {
      files,
      bots,
      workspace,
      inspection: { manifest, fileCount: inventory.size, expandedBytes, botCount: bots.length, attachmentCount: workspace.attachments.length, warnings },
    };
  }

  async restore(bytes: Buffer, options: RestoreOptions = {}): Promise<RestoreResult> {
    const validated = await this.inspect(bytes);
    if (options.dryRun) return { ...validated.inspection, dryRun: true };
    const selected = new Set(validated.bots.map((bot) => bot.id));
    const full = validated.inspection.manifest.scope.kind === "full";
    const staging = uniqueSibling(this.dataDir, "restore-staging");
    const preRestore = uniqueSibling(this.dataDir, "pre-restore");
    let oldRenamed = false;
    let newRenamed = false;
    try {
      mkdirSync(dirname(this.dataDir), { recursive: true, mode: 0o700 });
      if (existsSync(this.dataDir)) {
        const dataStat = lstatSync(this.dataDir);
        if (!dataStat.isDirectory() || dataStat.isSymbolicLink()) throw httpError(409, "Cumea data directory is not a safe restore target");
        cpSync(this.dataDir, staging, { recursive: true, dereference: false, preserveTimestamps: true });
      }
      else mkdirSync(staging, { recursive: true, mode: 0o700 });
      removePortableState(staging, full ? undefined : selected);
      if (full) {
        mkdirSync(join(staging, "events"), { recursive: true, mode: 0o700 });
        mkdirSync(join(staging, "native"), { recursive: true, mode: 0o700 });
      }

      // Remembered grants are authority, not portable preferences. Remove
      // restored identities in staging so a reload can never briefly attach
      // target-host auto-approval rules to imported work.
      const approvalPath = join(staging, "approval-rules.json");
      const approvalDocument = readJsonStrict(approvalPath, { version: 1, rules: [] }, "approval rule registry");
      if (!isPlainRecord(approvalDocument) || !Array.isArray(approvalDocument.rules)) throw httpError(409, "approval rule registry is corrupt");
      if (approvalDocument.rules.some((rule) => !isPlainRecord(rule) || typeof rule.botId !== "string" || !BOT_ID.test(rule.botId))) {
        throw httpError(409, "approval rule registry contains a corrupt record");
      }
      const safeRules = full
        ? []
        : approvalDocument.rules.filter((rule) => !selected.has((rule as Record<string, unknown>).botId as string));
      writeFileAtomic(approvalPath, jsonBytes({ version: 1, rules: safeRules }), { mode: 0o600 });

      let bots = validated.bots as Array<Record<string, unknown>>;
      let workspace = structuredClone(validated.workspace);
      if (!full) {
        const currentBots = readJsonStrict(join(this.dataDir, "bots.json"), [], "current agent roster");
        if (!Array.isArray(currentBots) || currentBots.some((row) => !isPlainRecord(row) || typeof row.id !== "string" || !BOT_ID.test(row.id) || typeof row.threadId !== "string" || !THREAD_ID.test(row.threadId))) {
          throw httpError(409, "current agent roster is corrupt");
        }
        const currentRows = currentBots as Array<Record<string, unknown>>;
        const portableCurrentBots = currentRows.map((row) => portableBot(row, []));
        if (portableCurrentBots.some((row) => !row)) throw httpError(409, "current agent roster contains a corrupt record");
        const survivors = currentRows.filter((row) => typeof row.id !== "string" || !selected.has(row.id));
        const survivorThreadIds = new Set(survivors.flatMap((row) => typeof row.threadId === "string" ? [row.threadId] : []));
        if (validated.bots.some((bot) => survivorThreadIds.has(bot.threadId))) throw httpError(409, "agent backup conflicts with an existing conversation id");
        for (const row of currentRows) {
          if (typeof row.id === "string" && selected.has(row.id) && typeof row.threadId === "string" && THREAD_ID.test(row.threadId)) {
            rmSync(join(staging, `messages-${row.threadId}.json`), { force: true });
            rmSync(join(staging, "events", `${row.threadId}.ndjson`), { force: true });
            rmSync(join(staging, "native", `${row.threadId}.ndjson`), { force: true });
          }
        }
        for (const bot of validated.bots) {
          rmSync(join(staging, "events", `${bot.threadId}.ndjson`), { force: true });
          rmSync(join(staging, "native", `${bot.threadId}.ndjson`), { force: true });
        }
        bots = [
          ...survivors,
          ...bots,
        ] as Array<Record<string, unknown>>;
        const current = readJsonStrict(join(this.dataDir, "workspace.json"), emptyWorkspace(), "current workspace database");
        if (!isPlainRecord(current)) throw httpError(409, "current workspace database is corrupt");
        const currentWorkspace = current;
        const collection = (key: keyof PortableWorkspace) => {
          const rows = currentWorkspace[key];
          if (!Array.isArray(rows) || rows.some((row) => !isPlainRecord(row))) throw httpError(409, `current workspace ${key} collection is corrupt`);
          return rows as Array<Record<string, unknown>>;
        };
        // Validate retained records with the same consumer-facing schema as
        // imported data. Use a portable copy only for validation so original
        // local attachment paths and runtime-only bot fields remain intact.
        const currentBotIds = new Set((portableCurrentBots as PortableBot[]).map((bot) => bot.id));
        const validationWorkspace = portableWorkspace(currentWorkspace, currentBotIds, { kind: "full" }, []);
        const validationFiles = new Map<string, Buffer>();
        for (const attachment of validationWorkspace.attachments) {
          const source = collection("attachments").find((row) => row.id === attachment.id);
          if (!source || typeof source.storedPath !== "string") throw httpError(409, "current attachment metadata is corrupt");
          validationFiles.set(`payload/attachments/${attachment.id}`, readManagedAttachment(this.dataDir, attachment.botId, source.storedPath, attachment.size));
        }
        validateWorkspace(validationWorkspace, portableCurrentBots as PortableBot[], validationFiles);
        for (const [key, incoming] of [["attachments", workspace.attachments], ["tasks", workspace.tasks], ["runs", workspace.runs], ["routines", workspace.routines]] as const) {
          const survivorIds = new Set(collection(key).filter((row) => typeof row.botId !== "string" || !selected.has(row.botId)).flatMap((row) => typeof row.id === "string" ? [row.id] : []));
          if (incoming.some((row) => typeof row.id === "string" && survivorIds.has(row.id))) throw httpError(409, `agent backup conflicts with an existing ${key} id`);
        }
        workspace = {
          sections: [...new Map([...collection("sections"), ...workspace.sections].flatMap((row) => typeof row.id === "string" ? [[row.id, row] as const] : [])).values()],
          attachments: mergeById(collection("attachments"), workspace.attachments, selected) as PortableAttachment[],
          tasks: mergeById(collection("tasks"), workspace.tasks, selected),
          runs: mergeById(collection("runs"), workspace.runs, selected),
          routines: mergeById(collection("routines"), workspace.routines, selected),
        };
      }

      mkdirSync(join(staging, "attachments"), { recursive: true, mode: 0o700 });
      mkdirSync(join(staging, "bot-workspaces"), { recursive: true, mode: 0o700 });
      for (const attachment of workspace.attachments) {
        if (!selected.has(attachment.botId)) continue;
        const payload = validated.files.get(`payload/attachments/${attachment.id}`)!;
        const destination = join(staging, "attachments", attachment.botId, attachment.id);
        if (!isContained(staging, destination)) throw httpError(400, "attachment restore path escaped staging");
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        writeFileAtomic(destination, payload, { mode: 0o600 });
        attachment.storedPath = join(this.dataDir, "attachments", attachment.botId, attachment.id);
      }
      for (const [path, payload] of validated.files) {
        const skillMatch = path.match(/^payload\/skills\/([a-z0-9][a-z0-9-]{0,63})\/([0-9A-Za-z.+-]+)\/(manifest\.json|instructions\.md)$/);
        if (skillMatch) {
          const destination = join(staging, "skills", "packages", skillMatch[1], skillMatch[2], skillMatch[3]);
          if (!isContained(staging, destination)) throw httpError(400, "local skill restore path escaped staging");
          mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
          writeFileAtomic(destination, payload, { mode: 0o600 });
          continue;
        }
        let match = path.match(/^payload\/messages\/([A-Za-z0-9_-]+)\.json$/);
        if (match) {
          writeFileAtomic(join(staging, `messages-${match[1]}.json`), payload, { mode: 0o600 });
          continue;
        }
        match = path.match(/^payload\/memory\/([A-Za-z0-9_-]+)\.json$/);
        if (match) {
          writeFileAtomic(join(staging, `memory-${match[1]}.json`), payload, { mode: 0o600 });
          continue;
        }
        match = path.match(/^payload\/workspaces\/([A-Za-z0-9_-]+)\/(.+)$/);
        if (match) {
          const destination = resolve(staging, "bot-workspaces", match[1], match[2]);
          if (!isContained(join(staging, "bot-workspaces", match[1]), destination)) throw httpError(400, "workspace restore path escaped staging");
          mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
          writeFileAtomic(destination, payload, { mode: 0o600 });
        }
      }
      writeFileAtomic(join(staging, "bots.json"), jsonBytes(bots), { mode: 0o600 });
      writeFileAtomic(join(staging, "workspace.json"), jsonBytes(workspace), { mode: 0o600 });
      const profile = validated.files.get("payload/profile.json");
      if (full && profile) {
        const currentConfig = readJsonStrict(join(staging, "config.json"), {}, "current configuration");
        if (!isPlainRecord(currentConfig)) throw httpError(409, "current configuration is corrupt");
        const config = currentConfig;
        config.profile = parseJson(profile, "profile");
        writeFileAtomic(join(staging, "config.json"), jsonBytes(config), { mode: 0o600 });
      }
      if (options.failureInjection === "before-swap") throw new Error("injected restore failure before swap");
      if (existsSync(this.dataDir)) {
        renameSync(this.dataDir, preRestore);
        oldRenamed = true;
      }
      if (options.failureInjection === "after-old-rename") throw new Error("injected restore failure after old rename");
      renameSync(staging, this.dataDir);
      newRenamed = true;
      if (options.failureInjection === "after-new-rename") throw new Error("injected restore failure after new rename");
      options.reload?.();
      return { ...validated.inspection, dryRun: false, ...(oldRenamed ? { preRestoreBackup: preRestore } : {}) };
    } catch (error) {
      try {
        if (newRenamed && existsSync(this.dataDir)) renameSync(this.dataDir, uniqueSibling(this.dataDir, "failed-restore"));
        if (oldRenamed && existsSync(preRestore) && !existsSync(this.dataDir)) renameSync(preRestore, this.dataDir);
        options.reload?.();
      } catch (rollbackError) {
        throw httpError(500, "restore failed and rollback could not be completed", new AggregateError([error, rollbackError]));
      } finally {
        if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
      }
      throw httpError((error as { status?: number })?.status ?? 500, error instanceof Error ? error.message : "restore failed", error);
    }
  }
}
