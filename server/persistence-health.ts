import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export type PersistenceIssueKind = "malformed" | "oversized" | "unsupported" | "invalid_schema" | "unreadable";

interface PersistenceIssueInternal {
  id: string;
  path: string;
  label: string;
  kind: PersistenceIssueKind;
  detectedAt: number;
  bytes?: number;
  resetValue: unknown;
  recoveryPendingRestart?: boolean;
}

export interface PublicPersistenceIssue {
  id: string;
  store: string;
  file: string;
  kind: PersistenceIssueKind;
  detectedAt: number;
  bytes?: number;
  writesBlocked: true;
  recoveryPendingRestart?: true;
}

const issues = new Map<string, PersistenceIssueInternal>();

function issueId(path: string): string {
  return `persistence-${createHash("sha256").update(path).digest("hex").slice(0, 20)}`;
}

function classify(error: unknown): PersistenceIssueKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/too large|oversized/i.test(message)) return "oversized";
  if (/version|unsupported/i.test(message)) return "unsupported";
  if (error instanceof SyntaxError) return "malformed";
  if (/schema|invalid|corrupt/i.test(message)) return "invalid_schema";
  return "unreadable";
}

export function markPersistenceIssue(path: string, label: string, error: unknown, resetValue: unknown, bytes?: number): void {
  const id = issueId(path);
  const existing = issues.get(id);
  issues.set(id, {
    id, path, label, kind: classify(error), detectedAt: existing?.detectedAt ?? Date.now(),
    ...(bytes === undefined ? {} : { bytes }), resetValue,
  });
}

export function loadPersistentJson<T>(path: string, options: {
  label: string;
  missing: () => T;
  resetValue: unknown;
  validate: (value: unknown) => T;
  maxBytes?: number;
}): T {
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  let bytes: number | undefined;
  try {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        issues.delete(issueId(path));
        return options.missing();
      }
      throw error;
    }
    bytes = stat.size;
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("invalid schema: persistence target is not a regular file");
    if (stat.size > maxBytes) throw new Error(`persistence file is too large (${stat.size} bytes)`);
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let raw: string;
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.size !== stat.size) throw new Error("invalid schema: persistence file changed while opening");
      raw = readFileSync(fd, "utf8");
      if (Buffer.byteLength(raw, "utf8") !== opened.size) throw new Error("invalid schema: persistence file changed while reading");
    } finally {
      closeSync(fd);
    }
    const value = JSON.parse(raw);
    const parsed = options.validate(value);
    issues.delete(issueId(path));
    return parsed;
  } catch (error) {
    markPersistenceIssue(path, options.label, error, options.resetValue, bytes);
    return options.missing();
  }
}

export function assertPersistenceWritable(path: string): void {
  const issue = issues.get(issueId(path));
  if (!issue) return;
  throw Object.assign(new Error(`${issue.label} is corrupt; writes are blocked until it is restored or explicitly reset locally`), {
    status: 503,
    persistenceIssueId: issue.id,
  });
}

export function publicPersistenceIssues(): PublicPersistenceIssue[] {
  return [...issues.values()].map((issue) => ({
    id: issue.id,
    store: issue.label,
    file: basename(issue.path),
    kind: issue.kind,
    detectedAt: issue.detectedAt,
    ...(issue.bytes === undefined ? {} : { bytes: issue.bytes }),
    writesBlocked: true,
    ...(issue.recoveryPendingRestart ? { recoveryPendingRestart: true as const } : {}),
  }));
}

/** Explicit destructive recovery with preservation: copy the corrupt bytes to
 * a private recovery directory before atomically replacing the live file. */
export function resetPersistenceIssue(id: string, confirmation: string): { file: string; preservedAs: string } {
  const issue = issues.get(id);
  if (!issue) throw Object.assign(new Error("no such persistence issue"), { status: 404 });
  if (confirmation !== basename(issue.path)) {
    throw Object.assign(new Error(`type ${basename(issue.path)} to confirm reset`), { status: 400 });
  }
  if (issue.recoveryPendingRestart) throw Object.assign(new Error("this persistence reset is already waiting for an app restart"), { status: 409 });
  const recoveryDir = join(dirname(issue.path), "recovery");
  mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  const preserved = join(recoveryDir, `${basename(issue.path)}.${Date.now()}.${issue.id}.corrupt`);
  if (existsSync(issue.path)) {
    copyFileSync(issue.path, preserved);
    chmodSync(preserved, 0o600);
  }
  try {
    writeFileAtomic(issue.path, `${JSON.stringify(issue.resetValue, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    throw Object.assign(new Error("could not reset the persistence file; the original remains unchanged"), { status: 500, cause: error });
  }
  issue.recoveryPendingRestart = true;
  return { file: basename(issue.path), preservedAs: basename(preserved) };
}
