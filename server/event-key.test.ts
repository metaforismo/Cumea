import { describe, expect, it } from "vitest";

import { threadEventKey, threadEventPrefix } from "./event-key.ts";

describe("threadEventKey", () => {
  it("keeps identical provider IDs isolated between threads", () => {
    expect(threadEventKey("thread-a", "item-1")).not.toBe(threadEventKey("thread-b", "item-1"));
  });

  it("cannot collide by moving delimiters between values", () => {
    expect(threadEventKey("a:b", "c")).not.toBe(threadEventKey("a", "b:c"));
    expect(threadEventKey("thread-a", "item-1").startsWith(threadEventPrefix("thread-a"))).toBe(true);
  });
});
