import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DATA_DIR } from "./config.ts";
import type { Message } from "./store.ts";

const SCHEMA_VERSION = 1;
const STATE_ACTIVE = "active";
const STATE_PENDING_DELETE = "pending_delete";
const VALID_ROLES = new Set(["bot", "user"]);
const VALID_KINDS = new Set(["text", "options", "activity", "screen", "handoff"]);

export const TRANSCRIPT_DB_PATH = join(DATA_DIR, "transcripts.sqlite");

export interface TranscriptThreadState {
  threadId: string;
  revision: number;
  state: "active" | "pending_delete";
  legacySha256: string | null;
  importedAt: number | null;
  messageCount: number;
}

export interface TranscriptDeleteTransaction {
  rollback(): void;
  finalize(): void;
}

function statusError(status: number, message: string, cause?: unknown): Error {
  return Object.assign(new Error(message), { status, ...(cause === undefined ? {} : { cause }) });
}

function validateThreadId(threadId: string): string {
  if (!/^[\w-]{1,128}$/.test(threadId)) throw statusError(400, "invalid transcript thread id");
  return threadId;
}

function validateMessage(value: unknown, position: number): Message {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw statusError(500, `legacy transcript message ${position} is invalid`);
  }
  const message = value as Record<string, unknown>;
  if (typeof message.id !== "string" || !message.id || message.id.length > 200) {
    throw statusError(500, `legacy transcript message ${position} has an invalid id`);
  }
  if (typeof message.role !== "string" || !VALID_ROLES.has(message.role)) {
    throw statusError(500, `legacy transcript message ${position} has an invalid role`);
  }
  if (typeof message.kind !== "string" || !VALID_KINDS.has(message.kind)) {
    throw statusError(500, `legacy transcript message ${position} has an invalid kind`);
  }
  if (!Number.isSafeInteger(message.at) || (message.at as number) < 0) {
    throw statusError(500, `legacy transcript message ${position} has an invalid timestamp`);
  }
  return value as Message;
}

function parsePayload(payload: string): Message {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw statusError(500, "canonical transcript row contains invalid JSON", error);
  }
  return validateMessage(value, 0);
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function legacyTranscriptPath(threadId: string): string {
  return join(DATA_DIR, `messages-${validateThreadId(threadId)}.json`);
}

export class TranscriptStore {
  readonly path: string;
  private db: DatabaseSync;

  constructor(path = TRANSCRIPT_DB_PATH) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, "a", 0o600));
    try { chmodSync(path, 0o600); } catch {}

    const db = new DatabaseSync(path);
    try {
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; " +
        "PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;",
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS transcript_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transcript_threads (
          thread_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
          state TEXT NOT NULL DEFAULT '${STATE_ACTIVE}' CHECK(state IN ('${STATE_ACTIVE}', '${STATE_PENDING_DELETE}')),
          legacy_sha256 TEXT,
          imported_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS transcript_messages (
          thread_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
          message_id TEXT NOT NULL,
          at INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY(thread_id, message_id),
          UNIQUE(thread_id, ordinal),
          FOREIGN KEY(thread_id) REFERENCES transcript_threads(thread_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS transcript_messages_thread_ordinal
          ON transcript_messages(thread_id, ordinal);
      `);
      db.prepare(`
        INSERT INTO transcript_meta(key, value) VALUES('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(SCHEMA_VERSION));
    } catch (error) {
      try { db.close(); } catch {}
      throw error;
    }
    this.db = db;
  }

  close(): void {
    this.db.close();
  }

  threadState(threadId: string): TranscriptThreadState | null {
    validateThreadId(threadId);
    const row = this.db.prepare(`
      SELECT t.thread_id, t.revision, t.state, t.legacy_sha256, t.imported_at,
             COUNT(m.message_id) AS message_count
      FROM transcript_threads t
      LEFT JOIN transcript_messages m ON m.thread_id = t.thread_id
      WHERE t.thread_id = ?
      GROUP BY t.thread_id, t.revision, t.state, t.legacy_sha256, t.imported_at
    `).get(threadId) as
      | {
          thread_id: string;
          revision: number;
          state: "active" | "pending_delete";
          legacy_sha256: string | null;
          imported_at: number | null;
          message_count: number;
        }
      | undefined;
    return row
      ? {
          threadId: row.thread_id,
          revision: row.revision,
          state: row.state,
          legacySha256: row.legacy_sha256,
          importedAt: row.imported_at,
          messageCount: row.message_count,
        }
      : null;
  }

  /**
   * Atomically establish a canonical thread. Existing legacy JSON is parsed,
   * structurally validated, hashed, inserted, counted, and committed as one
   * SQLite transaction. A crash before COMMIT leaves no partial thread.
   */
  ensureImported(threadId: string, legacyPath = legacyTranscriptPath(threadId)): TranscriptThreadState {
    validateThreadId(threadId);
    const existing = this.threadState(threadId);
    if (existing) return existing;

    let messages: Message[] = [];
    let legacySha256: string | null = null;
    let importedAt: number | null = null;
    if (existsSync(legacyPath)) {
      const raw = readFileSync(legacyPath);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch (error) {
        throw statusError(500, "legacy transcript is unreadable; canonical migration was not attempted", error);
      }
      if (!Array.isArray(parsed)) {
        throw statusError(500, "legacy transcript root is not an array; canonical migration was not attempted");
      }
      const ids = new Set<string>();
      messages = parsed.map((value, index) => {
        const message = validateMessage(value, index);
        if (ids.has(message.id)) throw statusError(500, `legacy transcript contains duplicate message id ${message.id}`);
        ids.add(message.id);
        return message;
      });
      legacySha256 = sha256(raw);
      importedAt = Date.now();
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO transcript_threads(thread_id, revision, state, legacy_sha256, imported_at)
        VALUES(?, ?, '${STATE_ACTIVE}', ?, ?)
      `).run(threadId, messages.length ? 1 : 0, legacySha256, importedAt);
      const insert = this.db.prepare(`
        INSERT INTO transcript_messages(thread_id, ordinal, message_id, at, payload_json)
        VALUES(?, ?, ?, ?, ?)
      `);
      for (const [ordinal, message] of messages.entries()) {
        insert.run(threadId, ordinal, message.id, message.at, JSON.stringify(message));
      }
      const count = this.db.prepare(
        "SELECT COUNT(*) AS count FROM transcript_messages WHERE thread_id = ?",
      ).get(threadId) as { count: number };
      if (count.count !== messages.length) throw new Error("canonical transcript verification count mismatch");
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    const state = this.threadState(threadId);
    if (!state) throw new Error("canonical transcript import committed without thread state");
    return state;
  }

  messagesFor(threadId: string, legacyPath = legacyTranscriptPath(threadId)): Message[] {
    const state = this.ensureImported(threadId, legacyPath);
    if (state.state !== STATE_ACTIVE) throw statusError(409, "transcript is pending deletion");
    const rows = this.db.prepare(`
      SELECT payload_json FROM transcript_messages
      WHERE thread_id = ? ORDER BY ordinal ASC
    `).all(threadId) as unknown as Array<{ payload_json: string }>;
    return rows.map((row) => parsePayload(row.payload_json));
  }

  append(threadId: string, message: Message, legacyPath = legacyTranscriptPath(threadId)): number {
    const state = this.ensureImported(threadId, legacyPath);
    if (state.state !== STATE_ACTIVE) throw statusError(409, "transcript is pending deletion");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const ordinalRow = this.db.prepare(
        "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM transcript_messages WHERE thread_id = ?",
      ).get(threadId) as { ordinal: number };
      this.db.prepare(`
        INSERT INTO transcript_messages(thread_id, ordinal, message_id, at, payload_json)
        VALUES(?, ?, ?, ?, ?)
      `).run(threadId, ordinalRow.ordinal, message.id, message.at, JSON.stringify(message));
      this.db.prepare("UPDATE transcript_threads SET revision = revision + 1 WHERE thread_id = ?").run(threadId);
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    return this.threadState(threadId)!.revision;
  }

  replaceMessage(threadId: string, message: Message): number {
    validateThreadId(threadId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`
        UPDATE transcript_messages SET at = ?, payload_json = ?
        WHERE thread_id = ? AND message_id = ?
      `).run(message.at, JSON.stringify(message), threadId, message.id);
      if (Number(result.changes) !== 1) throw statusError(404, "no such canonical transcript message");
      this.db.prepare("UPDATE transcript_threads SET revision = revision + 1 WHERE thread_id = ? AND state = ?")
        .run(threadId, STATE_ACTIVE);
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    return this.threadState(threadId)!.revision;
  }

  /**
   * Phase one of deletion keeps all message bytes present and reversible.
   * Startup can recover an interrupted transaction by comparing pending
   * threads with the authoritative bot roster.
   */
  stageDelete(threadId: string): TranscriptDeleteTransaction {
    validateThreadId(threadId);
    const state = this.threadState(threadId);
    if (!state) throw statusError(404, "no such canonical transcript");
    if (state.state !== STATE_ACTIVE) throw statusError(409, "canonical transcript deletion is already pending");
    this.db.prepare("UPDATE transcript_threads SET state = ? WHERE thread_id = ?").run(STATE_PENDING_DELETE, threadId);
    let settled = false;
    return {
      rollback: () => {
        if (settled) return;
        this.db.prepare("UPDATE transcript_threads SET state = ? WHERE thread_id = ?").run(STATE_ACTIVE, threadId);
        settled = true;
      },
      finalize: () => {
        if (settled) return;
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("DELETE FROM transcript_threads WHERE thread_id = ? AND state = ?")
            .run(threadId, STATE_PENDING_DELETE);
          this.db.exec("COMMIT");
          this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
          settled = true;
        } catch (error) {
          try { this.db.exec("ROLLBACK"); } catch {}
          throw error;
        }
      },
    };
  }

  /**
   * Recover a process crash that happened after phase-one deletion. A thread
   * still owned by a bot becomes active again. Orphaned pending rows are
   * finalized and scrubbed because the bot metadata commit already won.
   */
  recoverPendingDeletes(activeThreadIds: ReadonlySet<string>): { restored: number; finalized: number } {
    const rows = this.db.prepare(
      "SELECT thread_id FROM transcript_threads WHERE state = ? ORDER BY thread_id",
    ).all(STATE_PENDING_DELETE) as unknown as Array<{ thread_id: string }>;
    let restored = 0;
    let finalized = 0;
    for (const row of rows) {
      if (activeThreadIds.has(row.thread_id)) {
        this.db.prepare("UPDATE transcript_threads SET state = ? WHERE thread_id = ?")
          .run(STATE_ACTIVE, row.thread_id);
        restored += 1;
      } else {
        this.db.prepare("DELETE FROM transcript_threads WHERE thread_id = ?").run(row.thread_id);
        finalized += 1;
      }
    }
    if (finalized) this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return { restored, finalized };
  }

  backupTo(destination: string): void {
    if (!destination || destination === this.path) throw statusError(400, "invalid transcript backup destination");
    const escaped = destination.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
  }
}
