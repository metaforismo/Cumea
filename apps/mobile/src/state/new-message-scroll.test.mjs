import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_HIDDEN_NEWER_COUNT,
  acknowledgeNewest,
  initialNewMessageScrollState,
  isAtNewestEdge,
  observeMessageIds,
  updateNewestEdge,
} from "./new-message-scroll.ts";

test("initial hydration starts at newest without manufacturing unread rows", () => {
  const empty = initialNewMessageScrollState([]);
  assert.deepEqual(empty, { latestMessageId: null, atNewestEdge: true, hiddenNewerCount: 0 });

  const hydrated = observeMessageIds(empty, ["m1", "m2"]);
  assert.deepEqual(hydrated.state, { latestMessageId: "m2", atNewestEdge: true, hiddenNewerCount: 0 });
  assert.equal(hydrated.shouldJumpToNewest, false);
});

test("an append at the newest edge requests one non-animated follow jump", () => {
  const initial = initialNewMessageScrollState(["m1", "m2"]);
  const next = observeMessageIds(initial, ["m1", "m2", "m3", "m4"]);
  assert.equal(next.shouldJumpToNewest, true);
  assert.deepEqual(next.state, { latestMessageId: "m4", atNewestEdge: true, hiddenNewerCount: 0 });
});

test("reading history preserves the viewport and counts only appended IDs", () => {
  let state = updateNewestEdge(initialNewMessageScrollState(["m1", "m2"]), 160);
  assert.equal(state.atNewestEdge, false);

  let observed = observeMessageIds(state, ["m1", "m2", "m3", "m4"]);
  assert.equal(observed.shouldJumpToNewest, false);
  assert.equal(observed.state.hiddenNewerCount, 2);
  state = observed.state;

  observed = observeMessageIds(state, ["m1", "m2", "m3", "m4"]);
  assert.equal(observed.state.hiddenNewerCount, 2, "same latest ID must not double count streaming/settled updates");

  observed = observeMessageIds(state, ["older", "m1", "m2", "m3", "m4", "m5"]);
  assert.equal(observed.state.hiddenNewerCount, 3, "prepending history must not count as newer messages");
});

test("resnapshot or search-window replacement re-anchors without guessing a count", () => {
  const reading = { latestMessageId: "old-latest", atNewestEdge: false, hiddenNewerCount: 7 };
  const replaced = observeMessageIds(reading, ["a", "b", "new-latest"]);
  assert.deepEqual(replaced.state, {
    latestMessageId: "new-latest",
    atNewestEdge: false,
    hiddenNewerCount: 0,
  });
  assert.equal(replaced.shouldJumpToNewest, false);
});

test("new-message count is bounded and returning to newest clears it", () => {
  const ids = Array.from({ length: MAX_HIDDEN_NEWER_COUNT + 50 }, (_, index) => `m-${index}`);
  const current = { latestMessageId: ids[0], atNewestEdge: false, hiddenNewerCount: 900 };
  const observed = observeMessageIds(current, ids);
  assert.equal(observed.state.hiddenNewerCount, MAX_HIDDEN_NEWER_COUNT);
  assert.deepEqual(acknowledgeNewest(observed.state), {
    ...observed.state,
    atNewestEdge: true,
    hiddenNewerCount: 0,
  });
});

test("inverted-list newest-edge detection tolerates bounce but fails closed on invalid offsets", () => {
  assert.equal(isAtNewestEdge(-20), true);
  assert.equal(isAtNewestEdge(0), true);
  assert.equal(isAtNewestEdge(80), true);
  assert.equal(isAtNewestEdge(80.1), false);
  assert.equal(isAtNewestEdge(Number.NaN), false);
  assert.equal(isAtNewestEdge(10, -1), false);
});
