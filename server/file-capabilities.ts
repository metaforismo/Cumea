import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { ATTACHMENTS_DIR, BOT_WORKSPACES_DIR, DATA_DIR } from "./config.ts";
import type { StagedFileDeletion } from "./delete-files.ts";
import { classifyPreviewFile, type PreviewFileKind } from "./document-preview.ts";

export const FILE_CAPABILITY_TTL_MS = 30 * 60_000;
export const FILE_CAPABILITY_MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CAPABILITIES = 64;
const MAX_CAPABILITY_BYTES = 96 * 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface FileCapability {
  token: string;
  botId: string;
  name: string;
  mime: string;
  kind: PreviewFileKind;
  size: number;
  bytes: Buffer;
  createdAt: number;
  expiresAt: number;
}

export interface ResolvedBotFile {
  name: string;
  bytes: Buffer;
  source: "local" | "cloud";
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function validateBotId(botId: string): string {
  if (!BOT_ID_PATTERN.test(botId)) throw httpError(400, "invalid bot id");
  return botId;
}

/** The only local directory whose files can become chat capabilities. */
export function botWorkspaceDirectory(botId: string): string {
  const directory = botWorkspacePath(botId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function botWorkspacePath(botId: string): string {
  const directory = resolve(BOT_WORKSPACES_DIR, validateBotId(botId));
  const root = resolve(BOT_WORKSPACES_DIR);
  const rel = relative(root, directory);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw httpError(400, "invalid bot workspace");
  return directory;
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

/**
 * Quarantine one exact per-bot workspace before the metadata transaction.
 *
 * The workspace is renamed as a directory on the same volume, so rollback is
 * still possible. Recursive deletion is used only for the random quarantine
 * child we just created; paths supplied by an agent never reach this helper.
 */
export function stageBotWorkspaceForDeletion(botId: string): StagedFileDeletion {
  const source = botWorkspacePath(botId);
  let sourceStat;
  try {
    sourceStat = lstatSync(source);
  } catch (error) {
    if (errno(error) === "ENOENT") return { purge() {}, rollback() {} };
    throw Object.assign(new Error("could not inspect bot workspace"), { status: 500, cause: error });
  }
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw Object.assign(new Error("bot workspace is not a safe directory"), { status: 500 });
  }

  const stagingRoot = join(DATA_DIR, ".delete-staging");
  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const quarantine = mkdtempSync(join(stagingRoot, "workspace-"));
  const staged = join(quarantine, "workspace");
  try {
    renameSync(source, staged);
  } catch (error) {
    try { rmdirSync(quarantine); } catch {}
    throw Object.assign(new Error("could not stage bot workspace"), { status: 500, cause: error });
  }

  let settled = false;
  return {
    purge: () => {
      if (settled) return;
      try {
        const stat = lstatSync(staged);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("quarantined workspace changed type");
        rmSync(staged, { recursive: true, force: false });
        rmdirSync(quarantine);
        settled = true;
      } catch (error) {
        throw Object.assign(new Error("could not finalize bot workspace deletion"), { status: 500, cause: error });
      }
    },
    rollback: () => {
      if (settled) return;
      try {
        renameSync(staged, source);
        rmdirSync(quarantine);
        settled = true;
      } catch (error) {
        throw Object.assign(new Error("could not restore bot workspace"), { status: 500, cause: error });
      }
    },
  };
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function cleanRequestedPath(value: unknown): string {
  if (typeof value !== "string") throw httpError(400, "file path required");
  const requested = value.trim();
  if (!requested || requested.length > 2048 || /[\u0000-\u001f\u007f]/.test(requested)) {
    throw httpError(400, "invalid file path");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(requested) && !/^[A-Za-z]:[\\/]/.test(requested)) {
    throw httpError(400, "URLs are not file paths");
  }
  return requested;
}

/**
 * Resolve and snapshot a local file without ever exposing its host path.
 *
 * Both lexical and realpath containment are required. The final component
 * cannot be a symlink. The open descriptor is re-checked before and after the
 * bounded read so a path swap fails closed instead of returning another file.
 */
export function readLocalBotFile(botId: string, requestedValue: unknown): ResolvedBotFile {
  const workspace = botWorkspacePath(botId);
  let root: string;
  try {
    root = realpathSync(workspace);
  } catch (error) {
    if (errno(error) === "ENOENT") throw httpError(404, "file not found in this bot's workspace");
    throw httpError(410, "this bot's workspace is unavailable");
  }
  const requested = cleanRequestedPath(requestedValue);
  const candidate = resolve(root, requested);
  if (!isContained(root, candidate)) throw httpError(403, "file is outside this bot's workspace");

  return snapshotLocalFile(root, candidate, basename(candidate));
}

/** Read a store-owned upload without accepting any client-provided path. */
export function readStoredAttachmentFile(storedPath: string, displayName: string): ResolvedBotFile {
  const lexicalRoot = resolve(ATTACHMENTS_DIR);
  const candidate = resolve(storedPath);
  if (!isContained(lexicalRoot, candidate)) throw httpError(403, "attachment is outside managed storage");
  let root: string;
  try {
    root = realpathSync(lexicalRoot);
  } catch {
    throw httpError(410, "attachment storage is unavailable");
  }
  const safeName = basename(displayName).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
  if (!safeName) throw httpError(400, "attachment name is invalid");
  return snapshotLocalFile(root, candidate, safeName);
}

function snapshotLocalFile(root: string, candidate: string, displayName: string): ResolvedBotFile {

  let before;
  try {
    before = lstatSync(candidate);
  } catch {
    throw httpError(404, "file not found in this bot's workspace");
  }
  if (!before.isFile() || before.isSymbolicLink()) throw httpError(400, "file must be a regular workspace file");
  if (before.size > FILE_CAPABILITY_MAX_FILE_BYTES) throw httpError(413, "file is larger than 25 MB");

  let canonical: string;
  try {
    canonical = realpathSync(candidate);
  } catch {
    throw httpError(404, "file not found in this bot's workspace");
  }
  if (!isContained(root, canonical)) throw httpError(403, "file is outside this bot's workspace");

  let fd: number | null = null;
  try {
    fd = openSync(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size !== before.size || opened.size > FILE_CAPABILITY_MAX_FILE_BYTES) {
      throw httpError(409, "file changed while it was being opened");
    }
    if (realpathSync(candidate) !== canonical) throw httpError(409, "file changed while it was being opened");
    const bytes = readFileSync(fd);
    if (bytes.length !== opened.size || realpathSync(candidate) !== canonical) {
      throw httpError(409, "file changed while it was being read");
    }
    return { name: displayName, bytes, source: "local" };
  } catch (error) {
    if ((error as { status?: number })?.status) throw error;
    throw httpError(404, "file could not be opened from this bot's workspace");
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Memory-bounded, process-local read capabilities. No path is stored or sent. */
export class FileCapabilityStore {
  private capabilities = new Map<string, FileCapability>();
  private byteCount = 0;
  private readonly now: () => number;
  private readonly onChange: () => void;

  constructor(now: () => number = Date.now, onChange: () => void = () => {}) {
    this.now = now;
    this.onChange = onChange;
  }

  private remove(token: string): void {
    const capability = this.capabilities.get(token);
    if (!capability) return;
    this.byteCount -= capability.bytes.length;
    this.capabilities.delete(token);
    this.onChange();
  }

  sweep(): void {
    const now = this.now();
    for (const [token, capability] of this.capabilities) {
      if (capability.expiresAt <= now) this.remove(token);
    }
  }

  issue(botId: string, file: ResolvedBotFile, options: { allowHtml?: boolean } = {}): FileCapability {
    validateBotId(botId);
    this.sweep();
    if (!file.bytes.length) throw httpError(400, "file is empty");
    if (file.bytes.length > FILE_CAPABILITY_MAX_FILE_BYTES) throw httpError(413, "file is larger than 25 MB");
    const identified = classifyPreviewFile(file.name, file.bytes);
    if (identified.kind === "html" && options.allowHtml !== true) {
      throw httpError(415, "HTML preview is limited to generated workspace artifacts");
    }
    while (
      this.capabilities.size >= MAX_CAPABILITIES ||
      (this.capabilities.size > 0 && this.byteCount + file.bytes.length > MAX_CAPABILITY_BYTES)
    ) {
      const oldest = this.capabilities.keys().next().value as string | undefined;
      if (!oldest) break;
      this.remove(oldest);
    }
    if (this.byteCount + file.bytes.length > MAX_CAPABILITY_BYTES) {
      throw httpError(413, "file exceeds the preview memory budget");
    }
    const createdAt = this.now();
    const capability: FileCapability = {
      token: randomBytes(32).toString("base64url"),
      botId,
      name: file.name.slice(0, 180),
      mime: identified.mime,
      kind: identified.kind,
      size: file.bytes.length,
      bytes: Buffer.from(file.bytes),
      createdAt,
      expiresAt: createdAt + FILE_CAPABILITY_TTL_MS,
    };
    this.capabilities.set(capability.token, capability);
    this.byteCount += capability.bytes.length;
    this.onChange();
    return capability;
  }

  get(token: string): FileCapability | null {
    if (!TOKEN_PATTERN.test(token)) return null;
    const capability = this.capabilities.get(token);
    if (!capability) return null;
    if (capability.expiresAt <= this.now()) {
      this.remove(token);
      return null;
    }
    return capability;
  }

  revokeBot(botId: string): void {
    for (const [token, capability] of this.capabilities) {
      if (capability.botId === botId) this.remove(token);
    }
  }

  /** Restore invalidates every byte snapshot, including capabilities whose
   * public bot id happens to exist in both the old and restored workspace. */
  clear(): void {
    this.capabilities.clear();
    this.byteCount = 0;
    this.onChange();
  }

  secretValues(): string[] {
    return [...this.capabilities.keys()];
  }
}

export function publicFileCapability(capability: FileCapability, source: ResolvedBotFile["source"]) {
  return {
    token: capability.token,
    name: capability.name,
    mime: capability.mime,
    kind: capability.kind,
    size: capability.size,
    source,
    expiresAt: capability.expiresAt,
    previewUrl: `/api/files/${capability.token}/preview`,
    downloadUrl: `/api/files/${capability.token}/download`,
  };
}
