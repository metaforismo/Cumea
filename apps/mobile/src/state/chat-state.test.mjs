import assert from "node:assert/strict";
import test from "node:test";
import { branchVersions, mergeChronological, newestBranchLeaf, pagingAfterPage, StreamDeltaBatcher, visibleBranch } from "./chat-state.ts";
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

test("visibleBranch follows only the selected root-to-leaf conversation", () => {
  const root = { id: "root", parentId: null, role: "agent", kind: "text", createdAt: 1 };
  const original = { id: "original", parentId: "root", role: "user", kind: "text", createdAt: 2 };
  const reply = { id: "reply", parentId: "original", role: "agent", kind: "text", createdAt: 3 };
  const edit = { id: "edit", parentId: "root", role: "user", kind: "text", createdAt: 4 };
  const editedReply = { id: "edited-reply", parentId: "edit", role: "agent", kind: "text", createdAt: 5 };
  const siblingActivity = { id: "activity", parentId: "root", role: "agent", kind: "activity", createdAt: 6 };
  const all = [root, original, reply, edit, editedReply, siblingActivity];

  assert.deepEqual(visibleBranch(all, "edited-reply").map((item) => item.id), ["root", "edit", "edited-reply"]);
  assert.deepEqual(visibleBranch(all, "reply").map((item) => item.id), ["root", "original", "reply"]);
  assert.deepEqual(branchVersions(all, edit).map((item) => item.id), ["original", "edit"]);
  const queued = { id: "queued", parentId: "root", role: "user", kind: "text", createdAt: 7, delivery: "queued" };
  const cancelled = { id: "cancelled", parentId: "root", role: "user", kind: "text", createdAt: 8, delivery: "cancelled" };
  assert.deepEqual(branchVersions([...all, queued, cancelled], edit).map((item) => item.id), ["original", "edit"]);
  assert.equal(newestBranchLeaf(all, "original"), "reply");
  assert.equal(newestBranchLeaf(all, "edit"), "edited-reply");
});

test("visibleBranch stops safely on malformed parent cycles", () => {
  const first = { id: "a", parentId: "b", createdAt: 1 };
  const second = { id: "b", parentId: "a", createdAt: 2 };
  assert.deepEqual(visibleBranch([first, second], "a").map((item) => item.id), ["b", "a"]);
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

test("paired mobile permission choices are always one-shot", () => {
  assert.deepEqual(responseDecision("permission", "Always allow"), {
    behavior: "allow",
  });
  assert.deepEqual(responseDecision("permission", "Never"), {
    behavior: "deny",
  });
});
