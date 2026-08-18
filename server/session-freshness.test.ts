import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SessionFreshnessStore } from "./session-freshness.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cumea-freshness-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("SessionFreshnessStore", () => {
  it("persists per-thread dispatched selection without transcript data", () => {
    const f = fixture();
    try {
      const first = new SessionFreshnessStore(f.root);
      first.mark("thread-1", { instanceId: "claude", model: "claude-sonnet-5" });
      const second = new SessionFreshnessStore(f.root);
      expect(second.get("thread-1")).toEqual({ instanceId: "claude", model: "claude-sonnet-5" });
      const disk = readFileSync(join(f.root, "session-freshness.json"), "utf8");
      expect(disk).toContain("claude-sonnet-5");
      expect(disk).not.toContain("messages");
      expect(disk).not.toContain("transcript");
    } finally {
      f.cleanup();
    }
  });

  it("treats missing or corrupt state as unknown so callers rebuild safely", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.root, "session-freshness.json"), "not-json");
      const store = new SessionFreshnessStore(f.root);
      expect(store.get("thread-1")).toBeNull();
      store.mark("thread-1", { instanceId: "codex", model: "gpt-5.6-sol" });
      expect(new SessionFreshnessStore(f.root).get("thread-1")).toEqual({
        instanceId: "codex",
        model: "gpt-5.6-sol",
      });
    } finally {
      f.cleanup();
    }
  });

  it("deletes one thread and invalidates all provider sessions", () => {
    const f = fixture();
    try {
      const store = new SessionFreshnessStore(f.root);
      store.mark("thread-a", { instanceId: "claude", model: "a" });
      store.mark("thread-b", { instanceId: "gemini", model: "b" });
      store.delete("thread-a");
      expect(store.get("thread-a")).toBeNull();
      expect(store.get("thread-b")).toEqual({ instanceId: "gemini", model: "b" });
      store.invalidateAll();
      expect(store.get("thread-b")).toBeNull();
      expect(new SessionFreshnessStore(f.root).get("thread-b")).toBeNull();
    } finally {
      f.cleanup();
    }
  });

  it("rejects malformed selections instead of persisting ambiguous state", () => {
    const f = fixture();
    try {
      const store = new SessionFreshnessStore(f.root);
      expect(() => store.mark("../thread", { instanceId: "claude", model: "model" })).toThrow(/invalid/);
      expect(() => store.mark("thread", { instanceId: "claude", model: "bad\nmodel" })).toThrow(/invalid/);
    } finally {
      f.cleanup();
    }
  });
});
