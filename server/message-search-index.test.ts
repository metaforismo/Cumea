import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MessageSearchIndex, searchableMessageText } from "./message-search-index.ts";
import type { Message } from "./store.ts";

const directories = new Set<string>();

function temporaryIndex() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cumea-message-search-"));
  directories.add(directory);
  return new MessageSearchIndex(path.join(directory, "message-search.sqlite"));
}

function message(id: string, patch: Partial<Message> = {}): Message {
  return {
    id,
    role: "bot",
    kind: "text",
    text: `message ${id}`,
    at: Number(id.replace(/\D/g, "")) || Date.now(),
    ...patch,
  };
}

afterEach(() => {
  for (const directory of directories) {
    directories.delete(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("MessageSearchIndex", () => {
  it("indexes only visible folded transcript text and excludes screen bytes", () => {
    const visible = searchableMessageText(
      message("1", {
        kind: "screen",
        text: undefined,
        png: "SECRET_PIXEL_BYTES",
        mime: "image/png",
        attachments: [{ id: "a", name: "report.pdf", mime: "application/pdf", size: 12 }],
        tool: { name: "browser.open", ok: true },
      }),
    );
    expect(visible).toContain("report.pdf");
    expect(visible).toContain("browser.open");
    expect(visible).not.toContain("SECRET_PIXEL_BYTES");
  });

  it("searches across threads and updates a patched message in place", () => {
    const index = temporaryIndex();
    try {
      index.upsert("thread-a", message("1", { text: "Alpha launch checklist" }));
      index.upsert("thread-b", message("2", { text: "Beta launch notes" }));
      const initial = index.search("launch", 10);
      expect(initial.available).toBe(true);
      expect(initial.hits.map((hit) => hit.threadId).sort()).toEqual(["thread-a", "thread-b"]);

      index.upsert("thread-a", message("1", { text: "Completely renamed topic" }));
      expect(index.search("Alpha", 10).hits).toEqual([]);
      expect(index.search("renamed", 10).hits[0]).toMatchObject({
        threadId: "thread-a",
        messageId: "1",
      });
    } finally {
      index.close();
    }
  });

  it("replaces and deletes one thread without touching another", () => {
    const index = temporaryIndex();
    try {
      index.replaceThread("thread-a", [message("1", { text: "first apple" }), message("2", { text: "second apple" })]);
      index.replaceThread("thread-b", [message("3", { text: "other apple" })]);
      expect(index.search("apple", 10).hits).toHaveLength(3);

      index.replaceThread("thread-a", [message("4", { text: "replacement orange" })]);
      expect(index.search("apple", 10).hits).toHaveLength(1);
      expect(index.search("orange", 10).hits[0]?.threadId).toBe("thread-a");

      index.deleteThread("thread-a");
      expect(index.search("orange", 10).hits).toEqual([]);
      expect(index.search("apple", 10).hits[0]?.threadId).toBe("thread-b");
    } finally {
      index.close();
    }
  });

  it("bounds query and result limits instead of exposing an unbounded local scan", () => {
    const index = temporaryIndex();
    try {
      index.upsert("thread-a", message("1", { text: "bounded search" }));
      expect(() => index.search(" ")).toThrow(/query required/);
      expect(() => index.search("x".repeat(201))).toThrow(/longer than 200/);
      expect(() => index.search("bounded", 0)).toThrow(/positive integer/);
      expect(index.search("bounded", 500).hits).toHaveLength(1);
    } finally {
      index.close();
    }
  });
});
