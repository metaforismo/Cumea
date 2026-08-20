import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

import { ATTACHMENTS_DIR, DATA_DIR } from "./config.ts";
import type { StagedFileDeletion } from "./delete-files.ts";

export type FilePreviewKind = "markdown" | "pdf" | "docx" | "binary";

export const FILE_CAPABILITY_TTL_MS = 30 * 60_000;
export const FILE_CAPABILITY_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const BOT_WORKSPACES_DIR = join(DATA_DIR, "bot-workspaces");
const MAX_CAPABILITIES = 64;
const MAX_CAPABILITY_BYTES = 96 * 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface ResolvedBotFile {
  name: string;
  bytes: Buffer;
  source: "local" | "attachment" | "cloud";
}

export interface FileCapability {
  token: string;
  botId: string;
  name: string;
  mime: string;
  kind: FilePreviewKind;
  source: ResolvedBotFile["source"];
  size: number;
  bytes: Buffer;
  createdAt: number;
  expiresAt: number;
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

function validateBotId(botId: string): string {
  if (!BOT_ID_PATTERN.test(botId)) throw httpError(400, "invalid bot id");
  return botId;
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function ensureWorkspaceRoot(): string {
  mkdirSync(BOT_WORKSPACES_DIR, { recursive: true, mode: 0o700 });
  const rootStat = lstatSync(BOT_WORKSPACES_DIR);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw httpError(500, "bot workspace root is not a safe directory");
  }
  return realpathSync(BOT_WORKSPACES_DIR);
}

function botWorkspacePath(botId: string): string {
  const root = ensureWorkspaceRoot();
  const directory = resolve(root, validateBotId(botId));
  const rel = relative(root, directory);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw httpError(400, "invalid bot workspace");
  return directory;
}

/** The only local directory whose agent-created files may later become read capabilities. */
export function botWorkspaceDirectory(botId: string): string {
  const directory = botWorkspacePath(botId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw httpError(500, "bot workspace is not a safe directory");
  return realpathSync(directory);
}

/**
 * Quarantine one exact per-bot workspace before durable bot metadata is deleted.
 * The same-volume rename makes rollback possible. Recursive deletion is used only
 * for the random quarantine child created by this process.
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

function safeDisplayName(value: string): string {
  const name = basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
  if (!name) throw httpError(400, "file name is invalid");
  return name;
}

function classifyFile(name: string, bytes: Buffer): { kind: FilePreviewKind; mime: string } {
  const extension = extname(name).toLowerCase();
  if ([".md", ".markdown", ".mdown"].includes(extension)) {
    const text = new TextDecoder("utf-8", { fatal: true });
    try {
      const decoded = text.decode(bytes);
      if (decoded.includes("\u0000")) throw new Error("binary");
    } catch {
      throw httpError(415, "Markdown file is not valid UTF-8 text");
    }
    return { kind: "markdown", mime: "text/markdown; charset=utf-8" };
  }
  if (extension === ".pdf") {
    const header = bytes.subarray(0, 8).toString("ascii");
    const trailer = bytes.subarray(Math.max(0, bytes.length - 2048)).toString("latin1");
    if (!/^%PDF-[12]\.[0-9]/.test(header) || !trailer.includes("%%EOF")) {
      throw httpError(415, "file extension says PDF, but the PDF signature is invalid");
    }
    return { kind: "pdf", mime: "application/pdf" };
  }
  if (extension === ".docx") {
    const signature = bytes.subarray(0, 4);
    const zip =
      signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
      signature.equals(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (!zip) throw httpError(415, "file extension says DOCX, but the ZIP signature is invalid");
    return {
      kind: "docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  return { kind: "binary", mime: "application/octet-stream" };
}

function snapshotLocalFile(root: string, candidate: string, displayName: string, source: ResolvedBotFile["source"]): ResolvedBotFile {
  let before;
  try {
    before = lstatSync(candidate);
  } catch {
    throw httpError(404, "file not found");
  }
  if (!before.isFile() || before.isSymbolicLink()) throw httpError(400, "file must be a regular file");
  if (before.size <= 0) throw httpError(400, "file is empty");
  if (before.size > FILE_CAPABILITY_MAX_FILE_BYTES) throw httpError(413, "file is larger than 25 MB");

  let canonical: string;
  try {
    canonical = realpathSync(candidate);
  } catch {
    throw httpError(404, "file not found");
  }
  if (!isContained(root, canonical)) throw httpError(403, "file is outside managed storage");

  let fd: number | null = null;
  try {
    fd = openSync(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size !== before.size || opened.size > FILE_CAPABILITY_MAX_FILE_BYTES) {
      throw httpError(409, "file changed while it was being opened");
    }
    if (realpathSync(candidate) !== canonical) throw httpError(409, "file changed while it was being opened");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      bytes.length !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      realpathSync(candidate) !== canonical
    ) {
      throw httpError(409, "file changed while it was being read");
    }
    return { name: safeDisplayName(displayName), bytes, source };
  } catch (error) {
    if ((error as { status?: number })?.status) throw error;
    throw httpError(404, "file could not be opened safely");
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Resolve and snapshot a local agent-created file without exposing its host path. */
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
  return snapshotLocalFile(root, candidate, basename(candidate), "local");
}

/** Read a store-owned upload without accepting any client-provided host path. */
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
  return snapshotLocalFile(root, candidate, displayName, "attachment");
}

/** Memory-bounded, process-local read capability. No host path is retained or projected. */
export class FileCapabilityStore {
  private capabilities = new Map<string, FileCapability>();
  private byteCount = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private remove(token: string): void {
    const capability = this.capabilities.get(token);
    if (!capability) return;
    this.byteCount -= capability.bytes.length;
    this.capabilities.delete(token);
  }

  sweep(): void {
    const now = this.now();
    for (const [token, capability] of this.capabilities) {
      if (capability.expiresAt <= now) this.remove(token);
    }
  }

  issue(botId: string, file: ResolvedBotFile): FileCapability {
    validateBotId(botId);
    this.sweep();
    if (!file.bytes.length) throw httpError(400, "file is empty");
    if (file.bytes.length > FILE_CAPABILITY_MAX_FILE_BYTES) throw httpError(413, "file is larger than 25 MB");
    const identified = classifyFile(file.name, file.bytes);
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
      name: safeDisplayName(file.name),
      mime: identified.mime,
      kind: identified.kind,
      source: file.source,
      size: file.bytes.length,
      bytes: Buffer.from(file.bytes),
      createdAt,
      expiresAt: createdAt + FILE_CAPABILITY_TTL_MS,
    };
    this.capabilities.set(capability.token, capability);
    this.byteCount += capability.bytes.length;
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
}

export function publicFileCapability(capability: FileCapability) {
  return {
    token: capability.token,
    name: capability.name,
    mime: capability.mime,
    kind: capability.kind,
    source: capability.source,
    size: capability.size,
    expiresAt: capability.expiresAt,
    previewUrl: `/api/files/${capability.token}/preview`,
    downloadUrl: `/api/files/${capability.token}/download`,
  };
}
