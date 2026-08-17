import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DATA_DIR } from "./config.ts";
import type { BotRecord, Message } from "./store.ts";

const SCHEMA_VERSION = 1;
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

export class MessageSearchIndex {
  readonly path: string;
  private db: DatabaseSync;
  private fts5 = false;

  constructor(path = join(DATA_DIR, "message-search.sqlite")) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try { chmodSync(path, 0o600); } catch {}
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`
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
    `);
    this.db.prepare(`
      INSERT INTO message_search_meta(key, value) VALUES('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(SCHEMA_VERSION));
    try {
      this.db.exec(`
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
  }

  close(): void {
    this.db.close();
  }

  mode(): "fts5" | "like" {
    return this.fts5 ? "fts5" : "like";
  }

  hasThread(threadId: string): boolean {
    const row = this.db.prepare("SELECT 1 AS present FROM message_search WHERE thread_id = ? LIMIT 1").get(threadId) as
      | { present: number }
      | undefined;
    return row?.present === 1;
  }

  upsert(threadId: string, message: Message): void {
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
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  replaceThread(threadId: string, messages: readonly Message[]): void {
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
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  seedLegacy(bots: readonly BotRecord[]): void {
    const marker = this.db.prepare("SELECT value FROM message_search_meta WHERE key = 'legacy_seed_v1'").get() as
      | { value: string }
      | undefined;
    if (marker?.value === "complete") return;

    for (const bot of bots) {
      if (this.hasThread(bot.threadId)) continue;
      const path = join(DATA_DIR, `messages-${bot.threadId}.json`);
      if (!existsSync(path)) continue;
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (Array.isArray(parsed)) this.replaceThread(bot.threadId, parsed as Message[]);
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
