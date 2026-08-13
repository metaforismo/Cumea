import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EVENTS_DIR } from "../config.ts";
import { EventLogWriter } from "./event-log.ts";

describe("EventLogWriter", () => {
  beforeEach(() => {
    rmSync(EVENTS_DIR, { recursive: true, force: true });
    mkdirSync(EVENTS_DIR, { recursive: true });
  });

  it("preserves order while coalescing adjacent events", () => {
    const writer = new EventLogWriter({ flushDelayMs: 60_000 });
    writer.append("thread-a", { id: 1 });
    writer.append("thread-a", { id: 2 });
    writer.append("thread-b", { id: 3 });
    writer.flush();

    expect(readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8"))
      .toBe('{"id":1}\n{"id":2}\n');
    expect(readFileSync(join(EVENTS_DIR, "thread-b.ndjson"), "utf8"))
      .toBe('{"id":3}\n');
  });

  it("flushes by byte threshold without waiting for the timer", () => {
    const writer = new EventLogWriter({ flushDelayMs: 60_000, maxBufferedBytes: 1 });
    writer.append("thread-a", { id: 1 });
    expect(readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8")).toBe('{"id":1}\n');
    writer.close();
  });

  it("flushes on the scheduled boundary", () => {
    vi.useFakeTimers();
    try {
      const writer = new EventLogWriter({ flushDelayMs: 25 });
      writer.append("thread-a", { id: 1 });
      vi.advanceTimersByTime(24);
      expect(() => readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8")).toThrow();
      vi.advanceTimersByTime(1);
      expect(readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8")).toBe('{"id":1}\n');
      writer.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops late events during deletion and resumes only after settlement", () => {
    const writer = new EventLogWriter({ flushDelayMs: 0 });
    writer.append("thread-a", { id: 1 });
    const deletion = writer.prepareThreadDeletion("thread-a");
    writer.append("thread-a", { id: 2 });
    expect(readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8")).toBe('{"id":1}\n');

    deletion.rollback();
    writer.append("thread-a", { id: 3 });
    expect(readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8"))
      .toBe('{"id":1}\n{"id":3}\n');
  });

  it("uses canonical liveness to reject events after finalized deletion", () => {
    const activeThreads = new Set(["thread-a"]);
    const writer = new EventLogWriter({
      flushDelayMs: 0,
      isThreadActive: (threadId) => activeThreads.has(threadId),
    });
    writer.append("thread-a", { id: 1 });
    const deletion = writer.prepareThreadDeletion("thread-a");
    // Canonical deletion commits the Store record before releasing the log
    // gate. Any provider callback that runs afterwards now fails liveness.
    activeThreads.delete("thread-a");
    deletion.finalize();
    rmSync(join(EVENTS_DIR, "thread-a.ndjson"));

    writer.append("thread-a", { id: 2 });
    writer.flush();

    expect(() => readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8")).toThrow();
  });

  it("drops deterministic late-event churn without retaining deleted thread ids", () => {
    const activeThreads = new Set<string>();
    const writer = new EventLogWriter({
      flushDelayMs: 0,
      isThreadActive: (threadId) => activeThreads.has(threadId),
    });

    for (let index = 0; index < 512; index += 1) {
      const threadId = `thread-${index}`;
      const file = join(EVENTS_DIR, `${threadId}.ndjson`);
      activeThreads.add(threadId);
      writer.append(threadId, { phase: "live" });
      const deletion = writer.prepareThreadDeletion(threadId);
      activeThreads.delete(threadId);
      deletion.finalize();
      rmSync(file);

      // Simulate callbacks from every retired provider session after the
      // deletion gate has settled. None may recreate private diagnostics.
      writer.append(threadId, { phase: "late" });
      expect(() => readFileSync(file, "utf8")).toThrow();
    }

    writer.flush();
    expect(activeThreads.size).toBe(0);
  });

  it("never grows the failed-write queue beyond the process-wide byte budget", () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    try {
      rmSync(EVENTS_DIR, { recursive: true, force: true });
      const writer = new EventLogWriter({ flushDelayMs: 25, maxBufferedBytes: 18, onError: (error) => errors.push(error) });
      writer.append("thread-a", { id: 1 });
      writer.append("thread-a", { id: 2 });
      writer.append("thread-a", { id: 3 });

      mkdirSync(EVENTS_DIR, { recursive: true });
      writer.flush();

      expect(readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8"))
        .toBe('{"id":1}\n{"id":2}\n');
      expect(errors.some((error) => String(error).includes("buffer full"))).toBe(true);
      writer.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed scheduled batch for a later retry", () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    try {
      rmSync(EVENTS_DIR, { recursive: true, force: true });
      const writer = new EventLogWriter({ flushDelayMs: 25, onError: (error) => errors.push(error) });
      writer.append("thread-a", { id: 1 });
      vi.advanceTimersByTime(25);
      expect(errors).toHaveLength(1);

      mkdirSync(EVENTS_DIR, { recursive: true });
      writer.append("thread-a", { id: 2 });
      vi.advanceTimersByTime(25);
      expect(readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8"))
        .toBe('{"id":1}\n{"id":2}\n');
      writer.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the deletion gate when its prepare flush fails", () => {
    const errors: unknown[] = [];
    rmSync(EVENTS_DIR, { recursive: true, force: true });
    const writer = new EventLogWriter({ flushDelayMs: 60_000, onError: (error) => errors.push(error) });
    writer.append("thread-a", { id: 1 });
    expect(() => writer.prepareThreadDeletion("thread-a")).toThrow();

    mkdirSync(EVENTS_DIR, { recursive: true });
    writer.append("thread-a", { id: 2 });
    writer.flush();
    expect(readFileSync(join(EVENTS_DIR, "thread-a.ndjson"), "utf8"))
      .toBe('{"id":1}\n{"id":2}\n');
    expect(errors).toHaveLength(0);
    writer.close();
  });
});
