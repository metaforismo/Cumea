import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DATA_DIR } from "./config.ts";
import type { BotRecord, Message } from "./store.ts";

const SCHEMA_VERSION = 2;
const MAX_QUERY_CHARS = 200;
const MAX_LIMIT = 50;
const MAX_SEARCH_TEXT_BYTES = 64 * 1024;
const MAX_PREVIEW_CHARS = 280;

export interface TranscriptSearchHit {
  threadId: string;
  messageId: string;
  at: number;
  role: Message["role"];
  kind: Message["kind"];
  preview: string;
}

export interface TranscriptSearchResult {
  available: boolean;
  mode: "fts5" | "like" | "unavailable";
  hits: TranscriptSearchHit[];
}

interface IndexRow {
  thread_id: string;
  message_id: string;
  at: number;
  role: Message["role"];
  kind: Message["kind"];
  search_text: string;
}

export interface CanonicalFileFingerprint {
  size: string;
  inode: string;
  mtimeNs: string;
  ctimeNs: string;
}

export function canonicalFileFingerprint(path: string): CanonicalFileFingerprint | null {
  try {
    const stat = statSync(path, { bigint: true });
    if (!stat.isFile()) return null;
    return {
      size: stat.size.toString(),
      inode: stat.ino.toString(),
      mtimeNs: stat.mtimeNs.toString(),
      ctimeNs: stat.ctimeNs.toString(),
    };
  } catch {
    return null;
  }
}

function normalizeVisibleText(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
}

/** Only user-visible folded transcript fields enter the local search index. */
export function searchableMessageText(message: Message): string {
  const parts = [
    message.text,
    message.card?.title,
    message.card?.subtitle,
    ...(message.card?.options ?? []),
    message.tool?.name,
    message.handoff?.fromName,
    message.handoff?.toName,
    message.handoff?.prompt,
    message.handoff?.reply,
    ...(message.attachments ?? []).map((attachment) => attachment.name),
  ]
    .map(normalizeVisibleText)
    .filter(Boolean);
  let text = parts.join("\n");
  while (Buffer.byteLength(text, "utf8") > MAX_SEARCH_TEXT_BYTES && text.length > 0) {
    text = text.slice(0, Math.max(0, Math.floor(text.length * 0.9)));
  }
  return text;
}

function preview(text: string, query: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_PREVIEW_CHARS) return clean;
  const lower = clean.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const at = lower.indexOf(needle);
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(MAX_PREVIEW_CHARS / 3));
  const end = Math.min(clean.length, start + MAX_PREVIEW_CHARS);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

function boundedQuery(raw: string): string {
  const query = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
  if (!query) throw Object.assign(new Error("search query required"), { status: 400 });
  if (query.length > MAX_QUERY_CHARS) {
    throw Object.assign(new Error(`search query is longer than ${MAX_QUERY_CHARS} characters`), { status: 400 });
  }
  return query;
}

function boundedLimit(raw: number | undefined): number {
  const value = raw ?? 24;
  if (!Number.isInteger(value) || value < 1) {
    throw Object.assign(new Error("search limit must be a positive integer"), { status: 400 });
  }
  return Math.min(value, MAX_LIMIT);
}

function ftsQuery(query: string): string {
  const tokens = query.split(/\s+/).filter(Boolean).slice(0, 16);
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" AND ");
}

function likePattern(query: string): string {
  return `%${query.toLocaleLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export const MESSAGE_SEARCH_DB_PATH = join(DATA_DIR, "message-search.sqlite");

export class MessageSearchIndex {
  readonly path: string;
  private db: DatabaseSync;
  private fts5 = false;

  constructor(path = MESSAGE_SEARCH_DB_PATH) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Create/repair the containing database path as owner-only before SQLite
    // opens it. DATA_DIR is already 0700, but the file itself should never
    // spend even a short creation window under a permissive umask.
    closeSync(openSync(path, "a", 0o600));
    try { chmodSync(path, 0o600); } catch {}

    const db = new DatabaseSync(path);
    this.db = db;
    try {
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;",
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS message_search_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS message_search (
          thread_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          at INTEGER NOT NULL,
          role TEXT NOT NULL,
          kind TEXT NOT NULL,
          search_text TEXT NOT NULL,
          PRIMARY KEY (thread_id, message_id)
        );
        CREATE INDEX IF NOT EXISTS message_search_thread_at
          ON message_search(thread_id, at DESC);
        CREATE TABLE IF NOT EXISTS message_search_thread_state (
          thread_id TEXT PRIMARY KEY,
          canonical_size TEXT NOT NULL,
          canonical_inode TEXT NOT NULL,
          canonical_mtime_ns TEXT NOT NULL,
          canonical_ctime_ns TEXT NOT NULL
        );
      `);
      db.prepare(`
        INSERT INTO message_search_meta(key, value) VALUES('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(SCHEMA_VERSION));
      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS message_search_fts USING fts5(
            thread_id UNINDEXED,
            message_id UNINDEXED,
            search_text,
            tokenize = 'unicode61 remove_diacritics 2'
          );
        `);
        this.fts5 = true;
      } catch {
        this.fts5 = false;
      }
    } catch (error) {
      // DatabaseSync can successfully open a corrupt/non-database file and
      // fail only on the first PRAGMA/schema statement. Close that partially
      // initialized handle before propagating the error; otherwise Windows
      // keeps the profile directory locked and recovery/deletion cannot run.
      try { db.close(); } catch {}
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  mode(): "fts5" | "like" {
    return this.fts5 ? "fts5" : "like";
  }

  private fingerprintMatches(threadId: string, fingerprint: CanonicalFileFingerprint): boolean {
    const row = this.db.prepare(
      "SELECT canonical_size, canonical_inode, canonical_mtime_ns, canonical_ctime_ns " +
        "FROM message_search_thread_state WHERE thread_id = ?",
    ).get(threadId) as
      | {
          canonical_size: string;
          canonical_inode: string;
          canonical_mtime_ns: string;
          canonical_ctime_ns: string;
        }
      | undefined;
    return Boolean(
      row &&
      row.canonical_size === fingerprint.size &&
      row.canonical_inode === fingerprint.inode &&
      row.canonical_mtime_ns === fingerprint.mtimeNs &&
      row.canonical_ctime_ns === fingerprint.ctimeNs
    );
  }

  private setFingerprint(threadId: string, fingerprint?: CanonicalFileFingerprint | null): void {
    if (!fingerprint) {
      this.db.prepare("DELETE FROM message_search_thread_state WHERE thread_id = ?").run(threadId);
      return;
    }
    this.db.prepare(
      "INSERT INTO message_search_thread_state(" +
        "thread_id, canonical_size, canonical_inode, canonical_mtime_ns, canonical_ctime_ns" +
      ") VALUES(?, ?, ?, ?, ?) " +
      "ON CONFLICT(thread_id) DO UPDATE SET " +
        "canonical_size = excluded.canonical_size, " +
        "canonical_inode = excluded.canonical_inode, " +
        "canonical_mtime_ns = excluded.canonical_mtime_ns, " +
        "canonical_ctime_ns = excluded.canonical_ctime_ns",
    ).run(threadId, fingerprint.size, fingerprint.inode, fingerprint.mtimeNs, fingerprint.ctimeNs);
  }

  upsert(
    threadId: string,
    message: Message,
    fingerprint?: CanonicalFileFingerprint | null,
  ): void {
    const text = searchableMessageText(message);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO message_search(thread_id, message_id, at, role, kind, search_text)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, message_id) DO UPDATE SET
          at = excluded.at,
          role = excluded.role,
          kind = excluded.kind,
          search_text = excluded.search_text
      `).run(threadId, message.id, message.at, message.role, message.kind, text);
      if (this.fts5) {
        this.db.prepare("DELETE FROM message_search_fts WHERE thread_id = ? AND message_id = ?").run(threadId, message.id);
        this.db.prepare(
          "INSERT INTO message_search_fts(thread_id, message_id, search_text) VALUES(?, ?, ?)",
        ).run(threadId, message.id, text);
      }
      this.setFingerprint(threadId, fingerprint);
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  replaceThread(
    threadId: string,
    messages: readonly Message[],
    fingerprint?: CanonicalFileFingerprint | null,
  ): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM message_search WHERE thread_id = ?").run(threadId);
      if (this.fts5) this.db.prepare("DELETE FROM message_search_fts WHERE thread_id = ?").run(threadId);
      const insert = this.db.prepare(`
        INSERT INTO message_search(thread_id, message_id, at, role, kind, search_text)
        VALUES(?, ?, ?, ?, ?, ?)
      `);
      const insertFts = this.fts5
        ? this.db.prepare("INSERT INTO message_search_fts(thread_id, message_id, search_text) VALUES(?, ?, ?)")
        : null;
      for (const message of messages) {
        const text = searchableMessageText(message);
        insert.run(threadId, message.id, message.at, message.role, message.kind, text);
        insertFts?.run(threadId, message.id, text);
      }
      this.setFingerprint(threadId, fingerprint);
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  deleteThread(threadId: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM message_search WHERE thread_id = ?").run(threadId);
      if (this.fts5) this.db.prepare("DELETE FROM message_search_fts WHERE thread_id = ?").run(threadId);
      this.db.prepare("DELETE FROM message_search_thread_state WHERE thread_id = ?").run(threadId);
      this.db.exec("COMMIT");
      // secure_delete scrubs deleted cells in the database. Truncating the
      // WAL after a privacy-sensitive thread deletion also removes older WAL
      // frames that could otherwise retain the indexed text until a later
      // checkpoint. This index is local/derived and has one owning process.
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  seedLegacy(bots: readonly BotRecord[]): void {
    // A cheap stat fingerprint closes the canonical-write → derived-index
    // crash window without parsing every transcript on every start. Atomic
    // canonical writes replace the file, so inode/ctime/mtime/size together
    // distinguish a newer JSON source even when message count is unchanged.
    for (const bot of bots) {
      const path = join(DATA_DIR, `messages-${bot.threadId}.json`);
      if (!existsSync(path)) continue;
      const fingerprint = canonicalFileFingerprint(path);
      if (fingerprint && this.fingerprintMatches(bot.threadId, fingerprint)) continue;
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (Array.isArray(parsed)) this.replaceThread(bot.threadId, parsed as Message[], fingerprint);
      } catch {
        // Match Store's existing recovery behavior: an unreadable/corrupt
        // legacy transcript is not allowed to prevent the rest of Cumea from
        // starting or indexing healthy threads.
      }
    }
    this.db.prepare(`
      INSERT INTO message_search_meta(key, value) VALUES('legacy_seed_v1', 'complete')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run();
  }

  search(rawQuery: string, rawLimit?: number): TranscriptSearchResult {
    const query = boundedQuery(rawQuery);
    const limit = boundedLimit(rawLimit);
    let rows: IndexRow[];
    if (this.fts5) {
      const match = ftsQuery(query);
      if (!match) return { available: true, mode: "fts5", hits: [] };
      rows = this.db.prepare(`
        SELECT m.thread_id, m.message_id, m.at, m.role, m.kind, m.search_text
        FROM message_search_fts AS f
        JOIN message_search AS m
          ON m.thread_id = f.thread_id AND m.message_id = f.message_id
        WHERE message_search_fts MATCH ?
        ORDER BY m.at DESC
        LIMIT ?
      `).all(match, limit) as unknown as IndexRow[];
    } else {
      rows = this.db.prepare(`
        SELECT thread_id, message_id, at, role, kind, search_text
        FROM message_search
        WHERE lower(search_text) LIKE ? ESCAPE '\\'
        ORDER BY at DESC
        LIMIT ?
      `).all(likePattern(query), limit) as unknown as IndexRow[];
    }
    return {
      available: true,
      mode: this.mode(),
      hits: rows.map((row) => ({
        threadId: row.thread_id,
        messageId: row.message_id,
        at: row.at,
        role: row.role,
        kind: row.kind,
        preview: preview(row.search_text, query),
      })),
    };
  }
}
