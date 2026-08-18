import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

const SCHEMA = "cumea.session-freshness";
const VERSION = 1;
const MAX_ENTRIES = 10_000;

export interface DispatchedSelection {
  state: "dispatched";
  instanceId: string;
  model: string;
}

export interface InvalidatedSelection {
  state: "invalidated";
}

export type SessionFreshnessRecord = DispatchedSelection | InvalidatedSelection;

interface Document {
  schema: typeof SCHEMA;
  version: typeof VERSION;
  threads: Record<string, SessionFreshnessRecord>;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validModel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\u0000\r\n]/.test(value);
}

function parseDocument(value: unknown): Map<string, SessionFreshnessRecord> {
  const out = new Map<string, SessionFreshnessRecord>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  if (
    record.schema !== SCHEMA ||
    record.version !== VERSION ||
    !record.threads ||
    typeof record.threads !== "object" ||
    Array.isArray(record.threads)
  ) return out;

  for (const [threadId, freshness] of Object.entries(record.threads as Record<string, unknown>).slice(0, MAX_ENTRIES)) {
    if (!validId(threadId) || !freshness || typeof freshness !== "object" || Array.isArray(freshness)) continue;
    const candidate = freshness as Record<string, unknown>;
    if (candidate.state === "invalidated") {
      out.set(threadId, { state: "invalidated" });
      continue;
    }
    if (
      candidate.state !== "dispatched" ||
      !validId(candidate.instanceId) ||
      !validModel(candidate.model)
    ) continue;
    out.set(threadId, { state: "dispatched", instanceId: candidate.instanceId, model: candidate.model });
  }
  return out;
}

export class SessionFreshnessStore {
  private readonly file: string;
  private readonly records: Map<string, SessionFreshnessRecord>;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = join(dataDir, "session-freshness.json");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      // Missing/corrupt freshness state is deliberately safe at the decision
      // layer: ambiguous native cursors rebuild canonical context.
    }
    this.records = parseDocument(parsed);
    try { chmodSync(this.file, 0o600); } catch {}
  }

  get(threadId: string): SessionFreshnessRecord | null {
    if (!validId(threadId)) return null;
    const value = this.records.get(threadId);
    return value ? { ...value } : null;
  }

  mark(threadId: string, selection: Omit<DispatchedSelection, "state">): void {
    if (!validId(threadId) || !validId(selection.instanceId) || !validModel(selection.model)) {
      throw new Error("invalid session freshness selection");
    }
    this.records.set(threadId, { state: "dispatched", ...selection });
    this.trim();
    this.save();
  }

  /** Persist invalidation before replacing the provider fleet. Old native
   * cursors may remain in bots.json, but this marker prevents them from ever
   * being mistaken for an unambiguous legacy session after restart. */
  invalidate(threadIds: readonly string[]): void {
    for (const threadId of threadIds) {
      if (!validId(threadId)) continue;
      this.records.set(threadId, { state: "invalidated" });
    }
    this.trim();
    this.save();
  }

  delete(threadId: string): void {
    if (!this.records.delete(threadId)) return;
    this.save();
  }

  private trim() {
    while (this.records.size > MAX_ENTRIES) {
      const first = this.records.keys().next().value;
      if (!first) break;
      this.records.delete(first);
    }
  }

  private save(): void {
    const threads = Object.fromEntries(this.records);
    const document: Document = { schema: SCHEMA, version: VERSION, threads };
    writeFileAtomic(this.file, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  }
}
