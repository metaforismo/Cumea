import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { EVENTS_DIR } from "../config.js";
/**
 * Per-thread append queue for the canonical NDJSON event log.
 *
 * Provider adapters may emit token deltas at high frequency. Opening and
 * closing a file for every token blocks the only Node event loop and slows
 * SSE fan-out. This logger batches only adjacent writes; it preserves exact
 * event order and never changes the event stream delivered to subscribers.
 */
export class EventLogWriter {
    flushDelayMs;
    maxBufferedBytes;
    isThreadActive;
    onError;
    pending = new Map();
    bufferedBytes = 0;
    timer = null;
    deletingThreads = new Set();
    constructor(options = {}) {
        this.flushDelayMs = options.flushDelayMs ?? 40;
        this.maxBufferedBytes = options.maxBufferedBytes ?? 64 * 1024;
        this.isThreadActive = options.isThreadActive ?? (() => true);
        this.onError = options.onError ?? ((error) => console.error("event log flush failed", error));
    }
    append(threadId, event) {
        // Deletion is serialized by the server. Drop diagnostics emitted by a
        // provider while its bot is being removed so the log cannot reappear
        // after the filesystem transaction has staged it.
        if (this.deletingThreads.has(threadId) || !this.isThreadActive(threadId))
            return;
        const chunk = `${JSON.stringify(event)}\n`;
        const bytes = Buffer.byteLength(chunk);
        // An individual oversized diagnostic is written directly rather than
        // entering the queue. If disk persistence is unavailable, dropping this
        // best-effort log event is safer than retaining an unbounded allocation.
        if (bytes > this.maxBufferedBytes) {
            try {
                appendFileSync(join(EVENTS_DIR, `${threadId}.ndjson`), chunk);
            }
            catch (error) {
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
            }
            catch (error) {
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
    flush() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const errors = [];
        for (const threadId of [...this.pending.keys()]) {
            try {
                this.flushThread(threadId);
            }
            catch (error) {
                errors.push(error);
            }
        }
        if (errors.length)
            throw new AggregateError(errors, "one or more event logs could not be flushed");
    }
    close() {
        this.flushBestEffort();
    }
    /** Flush and gate a thread so callers can safely stage its log file. */
    prepareThreadDeletion(threadId) {
        if (this.deletingThreads.has(threadId)) {
            throw Object.assign(new Error("event log deletion is already in progress"), { status: 409 });
        }
        if (!this.isThreadActive(threadId)) {
            throw Object.assign(new Error("event log thread is no longer active"), { status: 409 });
        }
        this.deletingThreads.add(threadId);
        try {
            this.flushThread(threadId);
        }
        catch (error) {
            this.deletingThreads.delete(threadId);
            throw error;
        }
        let settled = false;
        const rollback = () => {
            if (settled)
                return;
            settled = true;
            this.deletingThreads.delete(threadId);
        };
        const finalize = () => {
            if (settled)
                return;
            settled = true;
            this.deletingThreads.delete(threadId);
        };
        return { rollback, finalize };
    }
    flushThread(threadId) {
        const entry = this.pending.get(threadId);
        if (!entry)
            return;
        appendFileSync(join(EVENTS_DIR, `${threadId}.ndjson`), entry.chunks.join(""));
        this.pending.delete(threadId);
        this.bufferedBytes -= entry.bytes;
    }
    flushBestEffort() {
        try {
            this.flush();
        }
        catch (error) {
            // Runtime diagnostics must never take down provider streaming. Keep the
            // failed queue in memory so a later append/explicit flush can retry it.
            this.onError(error);
        }
    }
}
