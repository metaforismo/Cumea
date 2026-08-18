import { describe, expect, it } from "vitest";

import type { AttachmentRef, Message } from "./store.ts";
import {
  BUSY_STEERING_MAX_MESSAGES,
  assertBusySteeringCapacity,
  coalesceBusySteering,
  queuedSteering,
} from "./busy-steering.ts";

function queued(id: string, text: string, at: number, attachments: AttachmentRef[] = []): Message {
  return { id, role: "user", kind: "text", text, at, delivery: "queued", attachments };
}

describe("busy steering queue", () => {
  it("projects only explicitly queued user text messages", () => {
    const messages: Message[] = [
      queued("q1", "first", 1),
      { id: "normal", role: "user", kind: "text", text: "normal", at: 2 },
      { id: "bot", role: "bot", kind: "text", text: "bot", at: 3, delivery: "queued" },
      { id: "activity", role: "user", kind: "activity", at: 4, delivery: "queued", tool: { name: "x" } },
    ];
    expect(queuedSteering(messages)).toEqual([{ id: "q1", text: "first", attachmentIds: [], at: 1 }]);
  });

  it("enforces message, byte and attachment budgets before persistence", () => {
    const full = Array.from({ length: BUSY_STEERING_MAX_MESSAGES }, (_, index) => ({
      id: `q${index}`,
      text: "x",
      attachmentIds: [],
      at: index,
    }));
    expect(() => assertBusySteeringCapacity({ current: full, text: "next" })).toThrow(/queue is full/);

    expect(() => assertBusySteeringCapacity({
      current: [{ id: "q", text: "x".repeat(65 * 1024), attachmentIds: [], at: 1 }],
      text: "next",
    })).toThrow(/64 KiB/);

    const current = [{
      id: "q",
      text: "first",
      attachmentIds: Array.from({ length: 20 }, (_, index) => `a-${index}`),
      at: 1,
    }];
    expect(() => assertBusySteeringCapacity({
      current,
      text: "next",
      attachments: [{ id: "new", name: "n", mime: "text/plain", size: 1 }],
    })).toThrow(/20 attachments/);
  });

  it("coalesces queued notes in durable transcript order into one follow-up", () => {
    const items = queuedSteering([
      queued("b", "second", 20, [{ id: "same", name: "x", mime: "text/plain", size: 1 }]),
      queued("a", "first", 10, [
        { id: "first-file", name: "a", mime: "text/plain", size: 1 },
        { id: "same", name: "x", mime: "text/plain", size: 1 },
      ]),
    ]);
    expect(coalesceBusySteering(items)).toEqual({
      messageIds: ["a", "b"],
      text: "[Steering note 1/2]\nfirst\n\n[Steering note 2/2]\nsecond",
      attachmentIds: ["first-file", "same"],
    });
  });

  it("does not add labels to a single steering message", () => {
    expect(coalesceBusySteering([{ id: "q", text: "do this next", attachmentIds: [], at: 1 }]))
      .toMatchObject({ messageIds: ["q"], text: "do this next" });
  });
});
