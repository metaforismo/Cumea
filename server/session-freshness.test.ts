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
  it("persists pending before dispatch and confirms only the matching started session", () => {
    const f = fixture();
    try {
      const first = new SessionFreshnessStore(f.root);
      first.begin("thread-1", { instanceId: "claude", model: "claude-sonnet-5" });
      expect(new SessionFreshnessStore(f.root).get("thread-1")).toEqual({
        state: "pending",
        instanceId: "claude",
        model: "claude-sonnet-5",
      });
      expect(first.confirm("thread-1", "gemini")).toBe(false);
      expect(first.get("thread-1")?.state).toBe("pending");
      expect(first.confirm("thread-1", "claude")).toBe(true);
      expect(new SessionFreshnessStore(f.root).get("thread-1")).toEqual({
        state: "dispatched",
        instanceId: "claude",
        model: "claude-sonnet-5",
      });
      const disk = readFileSync(join(f.root, "session-freshness.json"), "utf8");
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
      store.begin("thread-1", { instanceId: "codex", model: "gpt-5.6-sol" });
      expect(new SessionFreshnessStore(f.root).get("thread-1")).toEqual({
        state: "pending",
        instanceId: "codex",
        model: "gpt-5.6-sol",
      });
    } finally {
      f.cleanup();
    }
  });

  it("keeps pending after a simulated crash until the next decision rebuilds", () => {
    const f = fixture();
    try {
      const store = new SessionFreshnessStore(f.root);
      store.begin("thread-crash", { instanceId: "claude", model: "claude-sonnet-5" });
      const restarted = new SessionFreshnessStore(f.root);
      expect(restarted.get("thread-crash")).toEqual({
        state: "pending",
        instanceId: "claude",
        model: "claude-sonnet-5",
      });
    } finally {
      f.cleanup();
    }
  });

  it("deletes one thread and persists provider-reload invalidation", () => {
    const f = fixture();
    try {
      const store = new SessionFreshnessStore(f.root);
      store.begin("thread-a", { instanceId: "claude", model: "a" });
      store.confirm("thread-a", "claude");
      store.begin("thread-b", { instanceId: "gemini", model: "b" });
      store.confirm("thread-b", "gemini");
      store.delete("thread-a");
      expect(store.get("thread-a")).toBeNull();
      expect(store.get("thread-b")).toEqual({ state: "dispatched", instanceId: "gemini", model: "b" });
      store.invalidate(["thread-b", "thread-c"]);
      expect(store.get("thread-b")).toEqual({ state: "invalidated" });
      expect(store.get("thread-c")).toEqual({ state: "invalidated" });
      expect(new SessionFreshnessStore(f.root).get("thread-b")).toEqual({ state: "invalidated" });
    } finally {
      f.cleanup();
    }
  });

  it("rejects malformed selections instead of persisting ambiguous state", () => {
    const f = fixture();
    try {
      const store = new SessionFreshnessStore(f.root);
      expect(() => store.begin("../thread", { instanceId: "claude", model: "model" })).toThrow(/invalid/);
      expect(() => store.begin("thread", { instanceId: "claude", model: "bad\nmodel" })).toThrow(/invalid/);
    } finally {
      f.cleanup();
    }
  });
});
