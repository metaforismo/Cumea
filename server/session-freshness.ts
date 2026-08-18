import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

const SCHEMA = "cumea.session-freshness";
const VERSION = 1;
const MAX_ENTRIES = 10_000;

export interface DispatchedSelection {
  instanceId: string;
  model: string;
}

interface Document {
  schema: typeof SCHEMA;
  version: typeof VERSION;
  threads: Record<string, DispatchedSelection>;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validModel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\u0000\r\n]/.test(value);
}

function parseDocument(value: unknown): Map<string, DispatchedSelection> {
  const out = new Map<string, DispatchedSelection>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  if (record.schema !== SCHEMA || record.version !== VERSION || !record.threads || typeof record.threads !== "object" || Array.isArray(record.threads)) {
    return out;
  }
  for (const [threadId, selection] of Object.entries(record.threads as Record<string, unknown>).slice(0, MAX_ENTRIES)) {
    if (!validId(threadId) || !selection || typeof selection !== "object" || Array.isArray(selection)) continue;
    const candidate = selection as Record<string, unknown>;
    if (!validId(candidate.instanceId) || !validModel(candidate.model)) continue;
    out.set(threadId, { instanceId: candidate.instanceId, model: candidate.model });
  }
  return out;
}

export class SessionFreshnessStore {
  private readonly file: string;
  private readonly selections: Map<string, DispatchedSelection>;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = join(dataDir, "session-freshness.json");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      // Missing/corrupt freshness state is deliberately safe: callers rebuild
      // canonical context instead of trusting a native resume cursor.
    }
    this.selections = parseDocument(parsed);
    try { chmodSync(this.file, 0o600); } catch {}
  }

  get(threadId: string): DispatchedSelection | null {
    if (!validId(threadId)) return null;
    const value = this.selections.get(threadId);
    return value ? { ...value } : null;
  }

  mark(threadId: string, selection: DispatchedSelection): void {
    if (!validId(threadId) || !validId(selection.instanceId) || !validModel(selection.model)) {
      throw new Error("invalid session freshness selection");
    }
    this.selections.set(threadId, { ...selection });
    while (this.selections.size > MAX_ENTRIES) {
      const first = this.selections.keys().next().value;
      if (!first) break;
      this.selections.delete(first);
    }
    this.save();
  }

  delete(threadId: string): void {
    if (!this.selections.delete(threadId)) return;
    this.save();
  }

  invalidateAll(): void {
    if (this.selections.size === 0) return;
    this.selections.clear();
    this.save();
  }

  private save(): void {
    const threads = Object.fromEntries(this.selections);
    const document: Document = { schema: SCHEMA, version: VERSION, threads };
    writeFileAtomic(this.file, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  }
}
