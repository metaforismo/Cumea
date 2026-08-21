import { describe, expect, it } from "vitest";

import { DEAD_RUN_SETTLE_TICKS, decideDeadReconciliation } from "./dead-run-reconciliation.ts";

describe("decideDeadReconciliation", () => {
  it("observes the first dead tick without settling", () => {
    expect(decideDeadReconciliation({ deadTicks: 0, tick: true })).toEqual({ settle: false, deadTicks: 1 });
  });

  it("settles on the second consecutive dead tick", () => {
    const first = decideDeadReconciliation({ deadTicks: 0, tick: true });
    expect(decideDeadReconciliation({ deadTicks: first.deadTicks, tick: true })).toEqual({
      settle: true,
      deadTicks: DEAD_RUN_SETTLE_TICKS,
    });
  });

  it("keeps settling once the run stays dead", () => {
    let state = { deadTicks: 0 };
    for (let i = 0; i < 5; i += 1) {
      state = decideDeadReconciliation({ deadTicks: state.deadTicks, tick: true });
    }
    expect(state).toEqual({ settle: true, deadTicks: 5 });
  });

  it("resets the count when a tick projects anything other than dead", () => {
    expect(decideDeadReconciliation({ deadTicks: 1, tick: false })).toEqual({ settle: false, deadTicks: 0 });
    expect(decideDeadReconciliation({ deadTicks: 4, tick: false })).toEqual({ settle: false, deadTicks: 0 });
  });

  it("requires fresh consecutive ticks after a recovery blip", () => {
    let decision = decideDeadReconciliation({ deadTicks: 1, tick: true }); // dead, dead
    expect(decision.settle).toBe(true);
    decision = decideDeadReconciliation({ deadTicks: decision.deadTicks, tick: false }); // recovers
    decision = decideDeadReconciliation({ deadTicks: decision.deadTicks, tick: true }); // dead again
    expect(decision).toEqual({ settle: false, deadTicks: 1 });
  });

  it("honors a custom threshold", () => {
    expect(decideDeadReconciliation({ deadTicks: 1, tick: true, requiredTicks: 3 })).toEqual({
      settle: false,
      deadTicks: 2,
    });
    expect(decideDeadReconciliation({ deadTicks: 2, tick: true, requiredTicks: 3 }).settle).toBe(true);
  });

  it("tolerates nonsensical accumulated counts", () => {
    expect(decideDeadReconciliation({ deadTicks: -7, tick: true })).toEqual({ settle: false, deadTicks: 1 });
    expect(decideDeadReconciliation({ deadTicks: Number.NaN, tick: true })).toEqual({ settle: false, deadTicks: 1 });
  });
});
