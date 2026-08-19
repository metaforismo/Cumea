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

export type FileCapabilitySource = "workspace" | "attachment";

export interface FileCapability {
  token: string;
  botId: string;
  name: string;
  mime: string;
  kind: PreviewFileKind;
  source: FileCapabilitySource;
  size: number;
  bytes: Buffer;
  createdAt: number;
  expiresAt: number;
}

export interface ResolvedBotFile {
  name: string;
  bytes: Buffer;
  source: FileCapabilitySource;
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

function botWorkspacePath(botId: string): string {
  const root = resolve(BOT_WORKSPACES_DIR);
  const directory = resolve(root, validateBotId(botId));
  const rel = relative(root, directory);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw httpError(400, "invalid bot workspace");
  return directory;
}

function checkedManagedDirectory(path: string, label: string): string {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (errno(error) === "ENOENT") throw httpError(410, label + " is unavailable");
    throw Object.assign(new Error("could not inspect " + label), { status: 500, cause: error });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw httpError(410, label + " is not a safe directory");
  try {
    return realpathSync(path);
  } catch {
    throw httpError(410, label + " is unavailable");
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

/** Quarantine one exact bot workspace without following any child symlink. */
export function stageBotWorkspaceForDeletion(botId: string): StagedFileDeletion {
  const root = checkedManagedDirectory(BOT_WORKSPACES_DIR, "bot workspace root");
  const source = resolve(root, validateBotId(botId));
  if (!isContained(root, source) || source === root) throw httpError(400, "invalid bot workspace");
  let stat;
  try {
    stat = lstatSync(source);
  } catch (error) {
    if (errno(error) === "ENOENT") return { purge() {}, rollback() {} };
    throw Object.assign(new Error("could not inspect bot workspace"), { status: 500, cause: error });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
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
        const current = lstatSync(staged);
        if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("quarantined workspace changed type");
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

function cleanRelativeRequestedPath(value: unknown): string {
  if (typeof value !== "string") throw httpError(400, "file path required");
  const requested = value.trim();
  if (!requested || requested.length > 2048 || /[\u0000-\u001f\u007f]/.test(requested)) {
    throw httpError(400, "invalid file path");
  }
  if (
    isAbsolute(requested) ||
    /^[A-Za-z]:[\\/]/.test(requested) ||
    /^\\\\/.test(requested) ||
    /^[a-z][a-z0-9+.-]*:/i.test(requested)
  ) {
    throw httpError(403, "file path must be relative to this bot's workspace");
  }
  return requested;
}

function sameOpenedFile(before: ReturnType<typeof lstatSync>, opened: ReturnType<typeof fstatSync>): boolean {
  return before.dev === opened.dev && before.ino === opened.ino && before.size === opened.size;
}

function snapshotLocalFile(root: string, candidate: string, displayName: string, source: FileCapabilitySource): ResolvedBotFile {
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
    if (!opened.isFile() || !sameOpenedFile(before, opened) || opened.size > FILE_CAPABILITY_MAX_FILE_BYTES) {
      throw httpError(409, "file changed while it was being opened");
    }
    if (realpathSync(candidate) !== canonical) throw httpError(409, "file changed while it was being opened");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (bytes.length !== opened.size || !sameOpenedFile(opened as ReturnType<typeof lstatSync>, after) || realpathSync(candidate) !== canonical) {
      throw httpError(409, "file changed while it was being read");
    }
    return { name: displayName, bytes, source };
  } catch (error) {
    if ((error as { status?: number })?.status) throw error;
    throw httpError(404, "file could not be opened safely");
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Resolve only a relative path inside one host-owned bot workspace. */
export function readLocalBotFile(botId: string, requestedValue: unknown): ResolvedBotFile {
  const managedRoot = checkedManagedDirectory(BOT_WORKSPACES_DIR, "bot workspace root");
  const workspace = resolve(managedRoot, validateBotId(botId));
  if (!isContained(managedRoot, workspace) || workspace === managedRoot) throw httpError(400, "invalid bot workspace");
  try {
    const stat = lstatSync(workspace);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw httpError(410, "bot workspace is not a safe directory");
  } catch (error) {
    if ((error as { status?: number })?.status) throw error;
    if (errno(error) === "ENOENT") throw httpError(404, "file not found in this bot's workspace");
    throw httpError(410, "this bot's workspace is unavailable");
  }
  const root = checkedManagedDirectory(workspace, "bot workspace");
  const requested = cleanRelativeRequestedPath(requestedValue);
  const candidate = resolve(root, requested);
  if (!isContained(root, candidate)) throw httpError(403, "file is outside this bot's workspace");
  return snapshotLocalFile(root, candidate, basename(candidate), "workspace");
}

/** Read a store-owned upload by its stored record; clients never supply this path. */
export function readStoredAttachmentFile(storedPath: string, displayName: string): ResolvedBotFile {
  const lexicalRoot = resolve(ATTACHMENTS_DIR);
  const candidate = resolve(storedPath);
  if (!isContained(lexicalRoot, candidate)) throw httpError(403, "attachment is outside managed storage");
  const root = checkedManagedDirectory(lexicalRoot, "attachment storage");
  const safeName = basename(displayName).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
  if (!safeName) throw httpError(400, "attachment name is invalid");
  return snapshotLocalFile(root, candidate, safeName, "attachment");
}

/** Memory-bounded, process-local snapshots. Tokens never encode a host path. */
export class FileCapabilityStore {
  private capabilities = new Map<string, FileCapability>();
  private byteCount = 0;
  constructor(private readonly now: () => number = Date.now) {}

  private remove(token: string): void {
    const capability = this.capabilities.get(token);
    if (!capability) return;
    this.byteCount -= capability.bytes.length;
    this.capabilities.delete(token);
  }

  sweep(): void {
    const now = this.now();
    for (const [token, capability] of this.capabilities) if (capability.expiresAt <= now) this.remove(token);
  }

  issue(botId: string, file: ResolvedBotFile): FileCapability {
    validateBotId(botId);
    this.sweep();
    if (!file.bytes.length) throw httpError(400, "file is empty");
    if (file.bytes.length > FILE_CAPABILITY_MAX_FILE_BYTES) throw httpError(413, "file is larger than 25 MB");
    const identified = classifyPreviewFile(file.name, file.bytes);
    while (
      this.capabilities.size >= MAX_CAPABILITIES ||
      (this.capabilities.size > 0 && this.byteCount + file.bytes.length > MAX_CAPABILITY_BYTES)
    ) {
      const oldest = this.capabilities.keys().next().value as string | undefined;
      if (!oldest) break;
      this.remove(oldest);
    }
    if (this.byteCount + file.bytes.length > MAX_CAPABILITY_BYTES) throw httpError(413, "file exceeds the preview memory budget");
    const createdAt = this.now();
    const capability: FileCapability = {
      token: randomBytes(32).toString("base64url"),
      botId,
      name: file.name.slice(0, 180),
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
    for (const [token, capability] of this.capabilities) if (capability.botId === botId) this.remove(token);
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
