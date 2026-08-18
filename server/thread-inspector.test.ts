import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readThreadInspector, THREAD_INSPECTOR_MAX_LIMIT } from "./thread-inspector.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cumea-inspector-"));
  const eventsDir = join(root, "events");
  const nativeDir = join(root, "native");
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(nativeDir, { recursive: true });
  return { root, eventsDir, nativeDir };
}

function runtime(threadId: string, overrides: Record<string, unknown> = {}) {
  return {
    eventId: crypto.randomUUID(),
    provider: "claudeAgent",
    providerInstanceId: "claude",
    threadId,
    createdAt: new Date().toISOString(),
    type: "turn.started",
    raw: { source: "should-not-leak", payload: { secret: "private" } },
    ...overrides,
  };
}

describe("thread inspector", () => {
  it("rejects path-shaped thread ids", () => {
    expect(() =>
      readThreadInspector({ eventsDir: "/tmp", nativeDir: "/tmp", threadId: "../escape" }),
    ).toThrow(/invalid thread id/);
  });

  it("returns an empty snapshot when diagnostic logs do not exist", () => {
    const f = fixture();
    try {
      expect(readThreadInspector({ ...f, threadId: "thread-1" })).toEqual({
        runtime: [],
        native: [],
        hasEarlier: { runtime: false, native: false },
      });
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("strips runtime raw payloads, skips invalid lines and bounds native payloads", () => {
    const f = fixture();
    const threadId = "thread-1";
    try {
      writeFileSync(
        join(f.eventsDir, `${threadId}.ndjson`),
        [
          JSON.stringify(runtime(threadId)),
          "not-json",
          JSON.stringify(
            runtime(threadId, {
              type: "runtime.error",
              message: "provider failed",
            }),
          ),
          JSON.stringify(runtime("another-thread")),
          "{torn",
        ].join("\n"),
      );
      writeFileSync(
        join(f.nativeDir, `${threadId}.ndjson`),
        [
          JSON.stringify({ at: new Date().toISOString(), dir: "out", source: "claude.sdk.message", msg: { prompt: "hello" } }),
          JSON.stringify({ at: new Date().toISOString(), dir: "in", source: "claude.sdk.message", msg: { huge: "x".repeat(20_000) } }),
        ].join("\n"),
      );

      const snapshot = readThreadInspector({ ...f, threadId, limit: 20 });
      expect(snapshot.runtime).toHaveLength(2);
      expect(snapshot.runtime[0].detail).not.toHaveProperty("raw");
      expect(JSON.stringify(snapshot.runtime)).not.toContain("should-not-leak");
      expect(snapshot.runtime[1].summary).toContain("provider failed");
      expect(snapshot.native).toHaveLength(2);
      expect(snapshot.native[0].payloadTruncated).toBe(false);
      expect(snapshot.native[1].payloadTruncated).toBe(true);
      expect(snapshot.native[1].payload).toMatchObject({ omitted: true });
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("keeps only the newest bounded valid records", () => {
    const f = fixture();
    const threadId = "thread-many";
    try {
      const lines = Array.from({ length: THREAD_INSPECTOR_MAX_LIMIT + 25 }, (_, index) =>
        JSON.stringify(
          runtime(threadId, {
            eventId: `event-${index}`,
            createdAt: new Date(1_700_000_000_000 + index).toISOString(),
          }),
        ),
      );
      writeFileSync(join(f.eventsDir, `${threadId}.ndjson`), `${lines.join("\n")}\n`);
      const snapshot = readThreadInspector({ ...f, threadId, limit: 10_000 });
      expect(snapshot.runtime).toHaveLength(THREAD_INSPECTOR_MAX_LIMIT);
      expect(snapshot.runtime.at(-1)?.detail.eventId).toBe(`event-${THREAD_INSPECTOR_MAX_LIMIT + 24}`);
      expect(snapshot.hasEarlier.runtime).toBe(true);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
