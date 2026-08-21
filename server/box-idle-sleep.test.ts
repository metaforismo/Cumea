import { describe, expect, it, vi } from "vitest";
import { BoxIdleSleepManager, type IdleSleepBlocker, type IdleSleepClock } from "./box-idle-sleep.ts";

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: IdleSleepClock = {
    now: () => now,
    setTimeout: (callback, delay) => { const key = ++id; timers.set(key, { at: now + delay, callback }); return key; },
    clearTimeout: (key) => { timers.delete(key as number); },
  };
  return {
    clock,
    advance: async (ms: number) => {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      }
      now = target;
      await Promise.resolve(); await Promise.resolve();
    },
    timers,
  };
}

function fixture(overrides: Partial<ConstructorParameters<typeof BoxIdleSleepManager>[0]> = {}) {
  const time = fakeClock();
  let blocker: IdleSleepBlocker | null = null;
  const sleep = vi.fn(async () => true);
  const manager = new BoxIdleSleepManager({ idleMs: () => 600_000, blocker: () => blocker, sleep, clock: time.clock, blockedRetryMs: 30_000, ...overrides });
  return { ...time, manager, sleep, setBlocker: (value: IdleSleepBlocker | null) => { blocker = value; } };
}

describe("BoxIdleSleepManager", () => {
  it("reschedules from the latest real activity", async () => {
    const f = fixture();
    f.manager.touch("bot");
    await f.advance(500_000);
    f.manager.touch("bot");
    await f.advance(599_999);
    expect(f.sleep).not.toHaveBeenCalled();
    await f.advance(1);
    expect(f.sleep).toHaveBeenCalledTimes(1);
    expect(f.manager.status("bot").state).toBe("sleep-requested");
  });

  it("rechecks blockers and sleeps only after they clear", async () => {
    const f = fixture();
    f.setBlocker("needs-attention");
    f.manager.touch("bot");
    await f.advance(600_000);
    expect(f.manager.status("bot")).toMatchObject({ state: "blocked", blocker: "needs-attention" });
    f.setBlocker(null);
    await f.advance(30_000);
    expect(f.sleep).toHaveBeenCalledTimes(1);
  });

  it("cancels deletion and shutdown timers", async () => {
    const f = fixture();
    f.manager.reconcile(["deleted", "alive"]);
    f.manager.cancel("deleted");
    await f.advance(600_000);
    expect(f.sleep).toHaveBeenCalledTimes(1);
    expect(f.sleep).toHaveBeenCalledWith("alive", expect.any(Function));
    f.manager.touch("later");
    f.manager.shutdown();
    await f.advance(600_000);
    expect(f.sleep).toHaveBeenCalledTimes(1);
  });

  it("does not loop after provider failure; new activity can retry", async () => {
    const time = fakeClock();
    const sleep = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
    const manager = new BoxIdleSleepManager({ idleMs: () => 10_000, blocker: () => null, sleep, clock: time.clock });
    manager.touch("bot");
    await time.advance(10_000);
    expect(manager.status("bot").state).toBe("error");
    await time.advance(100_000);
    expect(sleep).toHaveBeenCalledTimes(1);
    manager.touch("bot");
    await time.advance(10_000);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(manager.status("bot").state).toBe("sleep-requested");
  });

  it("makes activity wait for an already submitted sleep request", async () => {
    const time = fakeClock();
    let finish!: () => void;
    const sleep = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const manager = new BoxIdleSleepManager({ idleMs: () => 10_000, blocker: () => null, sleep, clock: time.clock });
    manager.touch("bot");
    await time.advance(10_000);
    expect(manager.status("bot").state).toBe("sleeping");
    manager.touch("bot");
    let activityEntered = false;
    const waiting = manager.waitForPendingSleep("bot").then(() => { activityEntered = true; });
    await Promise.resolve();
    expect(activityEntered).toBe(false);
    finish();
    await waiting;
    expect(activityEntered).toBe(true);
    expect(manager.status("bot").state).toBe("idle");
  });

  it("manual sleep and disabled policy expose honest states", () => {
    let idle: number | null = 600_000;
    const f = fixture({ idleMs: () => idle });
    f.manager.touch("bot");
    f.manager.beginManualSleep("bot");
    f.manager.markManualSleepResult("bot", false);
    expect(f.manager.status("bot").state).toBe("error");
    f.manager.markManualSleepResult("bot", true);
    expect(f.manager.status("bot").state).toBe("sleep-requested");
    idle = null;
    expect(f.manager.status("bot")).toEqual({ enabled: false, idleMs: null, state: "off", deadlineAt: null });
  });
});
