import { describe, expect, it } from "vitest";

import { LifecycleWatchdog } from "./lifecycle-watchdog.ts";

describe("LifecycleWatchdog", () => {
  it("moves working → no-signal → dead without killing the tracked run", () => {
    const watchdog = new LifecycleWatchdog({ noSignalMs: 100, deadMs: 300 });
    expect(watchdog.start("thread", "run", 1_000).state).toBe("working");

    expect(watchdog.tick(1_099).alerts).toEqual([]);
    const noSignal = watchdog.tick(1_100);
    expect(noSignal.projections[0].state).toBe("no_signal");
    expect(noSignal.alerts.map((alert) => alert.kind)).toEqual(["no_signal"]);
    expect(watchdog.tick(1_200).alerts).toEqual([]);

    const dead = watchdog.tick(1_300);
    expect(dead.projections[0].state).toBe("dead");
    expect(dead.alerts.map((alert) => alert.kind)).toEqual(["dead"]);
    expect(watchdog.get("thread")?.runId).toBe("run");
  });

  it("exempts explicit waiting-on-human time from no-signal/dead detection", () => {
    const watchdog = new LifecycleWatchdog({ noSignalMs: 100, deadMs: 300 });
    watchdog.start("thread", "run", 1_000);
    const waiting = watchdog.openWait("thread", "ask-1", "Approve deleting a file", 1_020);
    expect(waiting).toMatchObject({ state: "waiting", reason: "Approve deleting a file", waitingSince: 1_020 });

    const longWait = watchdog.tick(100_000);
    expect(longWait.projections[0].state).toBe("waiting");
    expect(longWait.alerts).toEqual([]);

    expect(watchdog.resolveWait("thread", "ask-1", 100_010)?.state).toBe("working");
    expect(watchdog.tick(100_109).alerts).toEqual([]);
    expect(watchdog.tick(100_110).alerts[0].kind).toBe("no_signal");
  });

  it("a new runtime signal recovers no-signal/dead state and re-arms alerts", () => {
    const watchdog = new LifecycleWatchdog({ noSignalMs: 100, deadMs: 300 });
    watchdog.start("thread", "run", 1_000);
    expect(watchdog.tick(1_100).alerts[0].kind).toBe("no_signal");
    expect(watchdog.signal("thread", 1_150)?.state).toBe("working");
    expect(watchdog.tick(1_249).alerts).toEqual([]);
    expect(watchdog.tick(1_250).alerts[0].kind).toBe("no_signal");
  });

  it("surfaces a bounded repeated-identical-effect alert once per repeat window", () => {
    const watchdog = new LifecycleWatchdog({
      noSignalMs: 1_000,
      deadMs: 2_000,
      repeatWindowMs: 100,
      repeatThreshold: 3,
    });
    watchdog.start("thread", "run", 0);
    expect(watchdog.recordEffect("thread", "  click   Save ", 10)).toBeNull();
    expect(watchdog.recordEffect("thread", "click save", 20)).toBeNull();
    expect(watchdog.recordEffect("thread", "CLICK SAVE", 30)).toMatchObject({
      kind: "repeated_effect",
      repeatCount: 3,
      signature: "click save",
    });
    expect(watchdog.recordEffect("thread", "click save", 40)).toBeNull();

    expect(watchdog.recordEffect("thread", "open settings", 50)).toBeNull();
    expect(watchdog.recordEffect("thread", "click save", 200)).toBeNull();
    expect(watchdog.recordEffect("thread", "click save", 210)).toBeNull();
    expect(watchdog.recordEffect("thread", "click save", 220)?.kind).toBe("repeated_effect");
  });

  it("bounds tracked conversations and replaces state when the same thread starts a new run", () => {
    const watchdog = new LifecycleWatchdog({ noSignalMs: 100, deadMs: 300, maxThreads: 1 });
    watchdog.start("thread", "run-1", 0);
    expect(watchdog.start("thread", "run-2", 10).runId).toBe("run-2");
    expect(() => watchdog.start("other", "run-3", 20)).toThrow(/thread bound/);
    watchdog.stop("thread");
    expect(watchdog.start("other", "run-3", 30).runId).toBe("run-3");
  });
});
