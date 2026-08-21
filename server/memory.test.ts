import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { AgentMemoryStore } from "./memory.ts";

describe("AgentMemoryStore", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("keeps revisions, provenance and optimistic concurrency", () => {
    let now = 100;
    const memory = new AgentMemoryStore(() => now++);
    const created = memory.create("bot-1", { path: "preferences", content: "The user prefers concise Italian.", pinned: true }, { source: "user" });
    const updated = memory.update("bot-1", created.id, {
      expectedRevision: 1,
      content: "The user prefers concise Italian with concrete evidence.",
    }, { source: "agent", threadId: "thread-1", runId: "run-1" });

    expect(updated).toMatchObject({ revision: 2, provenance: { source: "agent", threadId: "thread-1", runId: "run-1" } });
    expect(memory.revisions("bot-1", created.id).map((revision) => revision.revision)).toEqual([2, 1]);
    expect(() => memory.update("bot-1", created.id, { expectedRevision: 1, content: "stale" }, { source: "user" })).toThrow(/refresh/);
  });

  it("retrieves pinned and query-matching memory, then marks only successful answer use", () => {
    const memory = new AgentMemoryStore(() => 1_000);
    const pinned = memory.create("bot-1", { path: "profile", content: "Use Italian.", pinned: true }, { source: "user" });
    const project = memory.create("bot-1", { path: "projects/cumea", content: "Cumea uses a local harness and explicit approvals." }, { source: "user" });
    memory.create("bot-1", { path: "unrelated", content: "The garden needs water." }, { source: "user" });

    const context = memory.context("bot-1", "How does the Cumea harness work?");
    expect(context.text).toContain("profile.md");
    expect(context.text).toContain("projects/cumea.md");
    expect(context.text).not.toContain("garden");
    expect(context.revisionIds).toEqual(expect.arrayContaining([pinned.revisionId, project.revisionId]));

    memory.markUsedForAnswer("bot-1", context.revisionIds, "turn-1");
    memory.markUsedForAnswer("bot-1", context.revisionIds, "turn-1");
    expect(memory.list("bot-1").filter((document) => context.revisionIds.includes(document.revisionId)).every((document) => document.usedForAnswerCount === 1)).toBe(true);
  });

  it("rejects traversal and credential-shaped content, and stores owner-only JSON", () => {
    const memory = new AgentMemoryStore();
    expect(() => memory.create("bot-1", { path: "../secret", content: "safe" }, { source: "user" })).toThrow(/traversal/);
    expect(() => memory.create("bot-1", { path: "token", content: `token sk-${"a".repeat(24)}` }, { source: "user" })).toThrow(/credentials/);
    memory.create("bot-1", { path: "safe", content: "Remember this preference." }, { source: "user" });
    const raw = readFileSync(join(DATA_DIR, "memory-bot-1.json"), "utf8");
    expect(JSON.parse(raw).version).toBe(1);
  });

  it("hard-deletes the document and its revision history", () => {
    const memory = new AgentMemoryStore();
    const document = memory.create("bot-1", { path: "temporary", content: "Remove me." }, { source: "user" });
    expect(memory.delete("bot-1", document.id, document.revision)).toBe(true);
    expect(memory.list("bot-1")).toEqual([]);
    expect(() => memory.revisions("bot-1", document.id)).toThrow(/no such/);
  });
});
