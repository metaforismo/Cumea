import assert from "node:assert/strict";
import test from "node:test";
import { mergeChronological, pagingAfterPage, StreamDeltaBatcher } from "./chat-state.ts";
import { responseDecision } from "../host/response-decision.ts";

test("mergeChronological keeps live items, deduplicates pages, and sorts oldest first", () => {
  const optimistic = { id: "optimistic", createdAt: 40, text: "new live message" };
  const existing = { id: "middle", createdAt: 20, text: "old value" };
  const merged = mergeChronological(
    [existing, optimistic],
    [
      { id: "oldest", createdAt: 10, text: "older page" },
      { id: "middle", createdAt: 20, text: "patched value" },
    ],
  );

  assert.deepEqual(merged.map((message) => message.id), ["oldest", "middle", "optimistic"]);
  assert.equal(merged[1].text, "patched value");
  assert.equal(merged[2], optimistic);
});

test("pagingAfterPage exposes the opaque cursor and closes pagination at null", () => {
  const first = pagingAfterPage(undefined, "message%2F50", true);
  assert.deepEqual(first, {
    cursor: "message%2F50",
    initialized: true,
    hasMore: true,
    loading: false,
  });
  assert.deepEqual(pagingAfterPage(first, null, false), {
    cursor: null,
    initialized: true,
    hasMore: false,
    loading: false,
  });
});

test("StreamDeltaBatcher uses one timer and preserves per-agent token order", () => {
  const scheduled = [];
  const cancelled = [];
  const flushed = [];
  const batcher = new StreamDeltaBatcher(
    (batch) => flushed.push(batch),
    40,
    (callback, delay) => {
      const handle = { callback, delay };
      scheduled.push(handle);
      return handle;
    },
    (handle) => cancelled.push(handle),
  );

  batcher.append("a", "hel");
  batcher.append("a", "lo");
  batcher.append("b", "world");
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 40);

  scheduled[0].callback();
  assert.deepEqual(flushed, [{ a: "hello", b: "world" }]);
  assert.equal(cancelled.length, 0);
});

test("StreamDeltaBatcher can flush a closing agent without dropping another agent", () => {
  const scheduled = [];
  const flushed = [];
  const batcher = new StreamDeltaBatcher(
    (batch) => flushed.push(batch),
    40,
    (callback, delay) => {
      const handle = { callback, delay };
      scheduled.push(handle);
      return handle;
    },
    () => {},
  );

  batcher.append("closing", "final");
  batcher.append("still-running", "next");
  batcher.flush("closing");
  assert.deepEqual(flushed, [{ closing: "final" }]);

  scheduled[0].callback();
  assert.deepEqual(flushed, [{ closing: "final" }, { "still-running": "next" }]);
});

test("question choices never become permission decisions", () => {
  assert.deepEqual(responseDecision("question", "Never"), {
    behavior: "answer",
    message: "Never",
  });
  assert.deepEqual(responseDecision("question", "Allow"), {
    behavior: "answer",
    message: "Allow",
  });
});

test("only permission choices can remember approval policy", () => {
  assert.deepEqual(responseDecision("permission", "Always allow"), {
    behavior: "allow",
    rememberPolicy: "allow",
  });
  assert.deepEqual(responseDecision("permission", "Never"), {
    behavior: "deny",
    rememberPolicy: "deny",
  });
});
