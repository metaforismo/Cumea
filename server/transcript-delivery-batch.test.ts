import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { TranscriptStore } from "./transcript-store.ts";
import type { Message } from "./store.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function message(id: string, text: string): Message {
  return { id, role: "user", kind: "text", text, at: Date.now(), delivery: "queued" };
}

describe("canonical transcript batch replacement", () => {
  it("commits all delivery changes in one revision", () => {
    const dir = mkdtempSync(join(tmpdir(), "cumea-delivery-batch-"));
    dirs.push(dir);
    const store = new TranscriptStore(join(dir, "transcripts.sqlite"));
    store.ensureImported("thread");
    const a = message("a", "one");
    const b = message("b", "two");
    store.append("thread", a);
    store.append("thread", b);
    const before = store.threadState("thread")!.revision;
    const revision = store.replaceMessages("thread", [
      { ...a, delivery: "dispatching" },
      { ...b, delivery: "dispatching" },
    ]);
    expect(revision).toBe(before + 1);
    expect(store.messagesFor("thread").map((item) => item.delivery)).toEqual(["dispatching", "dispatching"]);
    store.close();
  });

  it("rolls the whole batch back when any message is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cumea-delivery-batch-"));
    dirs.push(dir);
    const store = new TranscriptStore(join(dir, "transcripts.sqlite"));
    store.ensureImported("thread");
    const a = message("a", "one");
    store.append("thread", a);
    const before = store.threadState("thread")!.revision;
    expect(() => store.replaceMessages("thread", [
      { ...a, delivery: "dispatching" },
      message("missing", "missing"),
    ])).toThrow(/missing/);
    expect(store.threadState("thread")!.revision).toBe(before);
    expect(store.messagesFor("thread")[0].delivery).toBe("queued");
    store.close();
  });
});
