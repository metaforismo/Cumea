import { describe, expect, it } from "vitest";

import { commitCaptureIfCurrent } from "./screen-capture.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("commitCaptureIfCurrent", () => {
  it("drops a capture that resolves after its bot is deleted", async () => {
    const capture = deferred<{ png: string }>();
    let botExists = true;
    let deleting = false;
    const committed: string[] = [];

    const pending = commitCaptureIfCurrent(
      () => capture.promise,
      () => botExists && !deleting,
      (frame) => committed.push(frame.png),
    );

    deleting = true;
    botExists = false;
    capture.resolve({ png: "late-private-frame" });

    await expect(pending).resolves.toBe(false);
    expect(committed).toEqual([]);
  });

  it("drops an old capture after a new poller generation replaces it", async () => {
    const capture = deferred<{ png: string }>();
    const oldEntry = {};
    let currentEntry: object | undefined = oldEntry;
    const committed: string[] = [];

    const pending = commitCaptureIfCurrent(
      () => capture.promise,
      () => currentEntry === oldEntry,
      (frame) => committed.push(frame.png),
    );

    currentEntry = {};
    capture.resolve({ png: "stale-generation-frame" });

    await expect(pending).resolves.toBe(false);
    expect(committed).toEqual([]);
  });

  it("commits a capture while its generation remains current", async () => {
    const entry = {};
    const currentEntry = entry;
    const committed: string[] = [];

    await expect(commitCaptureIfCurrent(
      async () => ({ png: "current-frame" }),
      () => currentEntry === entry,
      (frame) => committed.push(frame.png),
    )).resolves.toBe(true);
    expect(committed).toEqual(["current-frame"]);
  });
});
