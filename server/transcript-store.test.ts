import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TranscriptStore } from "./transcript-store.ts";
import type { Message } from "./store.ts";

const directories = new Set<string>();

function temp() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cumea-transcripts-"));
  directories.add(directory);
  return {
    directory,
    db: path.join(directory, "transcripts.sqlite"),
    legacy: path.join(directory, "messages-thread-a.json"),
  };
}

function message(id: string, text = `message ${id}`, at = Number(id.replace(/\D/g, "")) || Date.now()): Message {
  return { id, role: "bot", kind: "text", text, at };
}

afterEach(() => {
  for (const directory of directories) {
    directories.delete(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("TranscriptStore", () => {
  it("atomically imports, validates, hashes, and preserves a legacy transcript", () => {
    const paths = temp();
    const legacy = [message("m1", "alpha", 10), message("m2", "beta", 20)];
    const raw = `${JSON.stringify(legacy, null, 2)}\n`;
    writeFileSync(paths.legacy, raw);

    const store = new TranscriptStore(paths.db);
    try {
      const state = store.ensureImported("thread-a", paths.legacy);
      expect(state).toMatchObject({ state: "active", revision: 1, messageCount: 2 });
      expect(state.legacySha256).toMatch(/^[a-f0-9]{64}$/);
      expect(state.importedAt).toBeTypeOf("number");
      expect(store.messagesFor("thread-a", paths.legacy)).toEqual(legacy);
      expect(readFileSync(paths.legacy, "utf8")).toBe(raw);
    } finally {
      store.close();
    }
  });

  it("refuses corrupt or duplicate legacy data without leaving a partial canonical thread", () => {
    const paths = temp();
    writeFileSync(paths.legacy, "{not-json");
    const store = new TranscriptStore(paths.db);
    try {
      expect(() => store.ensureImported("thread-a", paths.legacy)).toThrow(/legacy transcript is unreadable/);
      expect(store.threadState("thread-a")).toBeNull();

      writeFileSync(paths.legacy, JSON.stringify([message("same"), message("same")]));
      expect(() => store.ensureImported("thread-a", paths.legacy)).toThrow(/duplicate message id/);
      expect(store.threadState("thread-a")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("appends and patches incrementally without rewriting the legacy source", () => {
    const paths = temp();
    const legacy = [message("m1", "before", 10)];
    const raw = JSON.stringify(legacy);
    writeFileSync(paths.legacy, raw);
    const store = new TranscriptStore(paths.db);
    try {
      store.ensureImported("thread-a", paths.legacy);
      expect(store.append("thread-a", message("m2", "second", 20), paths.legacy)).toBe(2);
      expect(store.replaceMessage("thread-a", message("m1", "after", 10))).toBe(3);
      expect(store.messagesFor("thread-a", paths.legacy).map((item) => item.text)).toEqual(["after", "second"]);
      expect(readFileSync(paths.legacy, "utf8")).toBe(raw);
    } finally {
      store.close();
    }
  });

  it("keeps phase-one deletion reversible, freezes mutations, and finalizes only on explicit commit", () => {
    const paths = temp();
    const store = new TranscriptStore(paths.db);
    try {
      store.append("thread-a", message("m1"), paths.legacy);
      const first = store.stageDelete("thread-a");
      expect(store.threadState("thread-a")?.state).toBe("pending_delete");
      expect(() => store.messagesFor("thread-a", paths.legacy)).toThrow(/pending deletion/);
      expect(() => store.append("thread-a", message("m2"), paths.legacy)).toThrow(/pending deletion/);
      expect(() => store.replaceMessage("thread-a", message("m1", "mutated"))).toThrow(/pending deletion/);
      first.rollback();
      expect(store.messagesFor("thread-a", paths.legacy)).toHaveLength(1);

      const second = store.stageDelete("thread-a");
      second.finalize();
      expect(store.threadState("thread-a")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("recovers interrupted pending deletes against the authoritative bot roster", () => {
    const paths = temp();
    const store = new TranscriptStore(paths.db);
    try {
      store.append("thread-a", message("a"), paths.legacy);
      store.append("thread-b", message("b"), path.join(paths.directory, "messages-thread-b.json"));
      store.stageDelete("thread-a");
      store.stageDelete("thread-b");

      expect(store.recoverPendingDeletes(new Set(["thread-a"]))).toEqual({ restored: 1, finalized: 1 });
      expect(store.threadState("thread-a")?.state).toBe("active");
      expect(store.threadState("thread-b")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("creates an independently readable SQLite backup", () => {
    const paths = temp();
    const backup = path.join(paths.directory, "transcripts-backup.sqlite");
    const store = new TranscriptStore(paths.db);
    store.append("thread-a", message("m1", "backup sentinel"), paths.legacy);
    store.backupTo(backup);
    store.close();

    expect(existsSync(backup)).toBe(true);
    const restored = new TranscriptStore(backup);
    try {
      expect(restored.messagesFor("thread-a", paths.legacy)[0]?.text).toBe("backup sentinel");
    } finally {
      restored.close();
    }
  });

  it("closes a partially initialized handle when the database is corrupt", () => {
    const paths = temp();
    writeFileSync(paths.db, "not a database");
    expect(() => new TranscriptStore(paths.db)).toThrow();
    // Windows proves the important part: a leaked DatabaseSync handle would
    // make recursive cleanup fail with EPERM.
    rmSync(paths.directory, { recursive: true, force: true });
    directories.delete(paths.directory);
  });
});
