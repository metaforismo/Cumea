import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { EVENTS_DIR } from "../config.ts";

export interface EventLogOptions {
  /** Flush queued events after this delay. Zero keeps deterministic tests synchronous. */
  flushDelayMs?: number;
  /** Hard process-wide bound for queued event bytes. */
  maxBufferedBytes?: number;
  /**
   * Canonical thread-liveness check. Production wires this to Store so a
   * provider event arriving after a committed bot deletion cannot recreate
   * the removed log. Keeping liveness outside the writer avoids retaining an
   * ever-growing tombstone set for every thread deleted during this process.
   */
  isThreadActive?: (threadId: string) => boolean;
  onError?: (error: unknown) => void;
}

interface PendingLog {
  chunks: string[];
  bytes: number;
}

export interface EventLogDeletionTransaction {
  rollback: () => void;
  finalize: () => void;
}

/**
 * Per-thread append queue for the canonical NDJSON event log.
 *
 * Provider adapters may emit token deltas at high frequency. Opening and
 * closing a file for every token blocks the only Node event loop and slows
 * SSE fan-out. This logger batches only adjacent writes; it preserves exact
 * event order and never changes the event stream delivered to subscribers.
 */
export class EventLogWriter {
  private readonly flushDelayMs: number;
  private readonly maxBufferedBytes: number;
  private readonly isThreadActive: (threadId: string) => boolean;
  private readonly onError: (error: unknown) => void;
  private readonly pending = new Map<string, PendingLog>();
  private bufferedBytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly deletingThreads = new Set<string>();

  constructor(options: EventLogOptions = {}) {
    this.flushDelayMs = options.flushDelayMs ?? 40;
    this.maxBufferedBytes = options.maxBufferedBytes ?? 64 * 1024;
    this.isThreadActive = options.isThreadActive ?? (() => true);
    this.onError = options.onError ?? (() => console.error("event log flush failed"));
  }

  append(threadId: string, event: unknown): void {
    // Deletion is serialized by the server. Drop diagnostics emitted by a
    // provider while its bot is being removed so the log cannot reappear
    // after the filesystem transaction has staged it.
    if (this.deletingThreads.has(threadId) || !this.isThreadActive(threadId)) return;
    const chunk = `${JSON.stringify(event)}\n`;
    const bytes = Buffer.byteLength(chunk);

    // An individual oversized diagnostic is written directly rather than
    // entering the queue. If disk persistence is unavailable, dropping this
    // best-effort log event is safer than retaining an unbounded allocation.
    if (bytes > this.maxBufferedBytes) {
      try {
        appendFileSync(join(EVENTS_DIR, `${threadId}.ndjson`), chunk);
      } catch (error) {
        this.onError(error);
      }
      return;
    }

    if (this.bufferedBytes + bytes > this.maxBufferedBytes) {
      this.flushBestEffort();
      if (this.bufferedBytes + bytes > this.maxBufferedBytes) {
        this.onError(new Error("event log buffer full; dropping newest event"));
        return;
      }
    }
    const current = this.pending.get(threadId) ?? { chunks: [], bytes: 0 };
    current.chunks.push(chunk);
    current.bytes += bytes;
    this.bufferedBytes += bytes;
    this.pending.set(threadId, current);

    if (this.bufferedBytes >= this.maxBufferedBytes || this.flushDelayMs === 0) {
      try {
        this.flushThread(threadId);
      } catch (error) {
        this.onError(error);
      }
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushBestEffort();
      }, this.flushDelayMs);
      this.timer.unref?.();
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const errors: unknown[] = [];
    for (const threadId of [...this.pending.keys()]) {
      try {
        this.flushThread(threadId);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "one or more event logs could not be flushed");
  }

  close(): void {
    this.flushBestEffort();
  }

  /** Flush and gate a thread so callers can safely stage its log file. */
  prepareThreadDeletion(threadId: string): EventLogDeletionTransaction {
    if (this.deletingThreads.has(threadId)) {
      throw Object.assign(new Error("event log deletion is already in progress"), { status: 409 });
    }
    if (!this.isThreadActive(threadId)) {
      throw Object.assign(new Error("event log thread is no longer active"), { status: 409 });
    }
    this.deletingThreads.add(threadId);
    try {
      this.flushThread(threadId);
    } catch (error) {
      this.deletingThreads.delete(threadId);
      throw error;
    }
    let settled = false;
    const rollback = () => {
      if (settled) return;
      settled = true;
      this.deletingThreads.delete(threadId);
    };
    const finalize = () => {
      if (settled) return;
      settled = true;
      this.deletingThreads.delete(threadId);
    };
    return { rollback, finalize };
  }

  private flushThread(threadId: string): void {
    const entry = this.pending.get(threadId);
    if (!entry) return;
    appendFileSync(join(EVENTS_DIR, `${threadId}.ndjson`), entry.chunks.join(""));
    this.pending.delete(threadId);
    this.bufferedBytes -= entry.bytes;
  }

  private flushBestEffort(): void {
    try {
      this.flush();
    } catch (error) {
      // Runtime diagnostics must never take down provider streaming. Keep the
      // failed queue in memory so a later append/explicit flush can retry it.
      this.onError(error);
    }
  }
}
