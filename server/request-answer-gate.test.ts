import { describe, expect, it } from "vitest";

import { createAnswerGate } from "./request-answer-gate.ts";

describe("createAnswerGate", () => {
  it("reserves a key exactly once while it is live", () => {
    const gate = createAnswerGate();
    expect(gate.reserve("t1:r1")).toBe(true);
    expect(gate.reserve("t1:r1")).toBe(false);
  });

  it("keeps keys independent", () => {
    const gate = createAnswerGate();
    expect(gate.reserve("t1:r1")).toBe(true);
    expect(gate.reserve("t1:r2")).toBe(true);
  });

  it("release lets a failed answer be retried", () => {
    const gate = createAnswerGate();
    gate.reserve("t1:r1");
    gate.release("t1:r1");
    expect(gate.reserve("t1:r1")).toBe(true);
  });

  it("settle retires the key like release", () => {
    const gate = createAnswerGate();
    gate.reserve("t1:r1");
    gate.settle("t1:r1");
    expect(gate.reserve("t1:r1")).toBe(true);
  });
});
