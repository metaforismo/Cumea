/**
 * Host-owned, per-bot idle policy for third-party Box computers.
 *
 * The manager deliberately knows nothing about bots, tasks or providers. The
 * host supplies a fresh safety check at the deadline and again immediately
 * before the provider call. A provider error is terminal for that idle period:
 * only real subsequent activity arms another attempt.
 */
export interface IdleSleepClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type IdleSleepBlocker =
  | "bot-missing"
  | "not-cloud"
  | "turn-active"
  | "queue-active"
  | "routine-active"
  | "needs-attention"
  | "screen-active"
  | "resource-active"
  | "deleting";

export interface IdleSleepStatus {
  enabled: boolean;
  idleMs: number | null;
  state: "off" | "idle" | "checking" | "blocked" | "sleeping" | "sleep-requested" | "error";
  deadlineAt: number | null;
  blocker?: IdleSleepBlocker;
}

interface Entry {
  generation: number;
  deadlineAt: number;
  timer: unknown | null;
  state: IdleSleepStatus["state"];
  blocker?: IdleSleepBlocker;
}

const systemClock: IdleSleepClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class BoxIdleSleepManager {
  private readonly entries = new Map<string, Entry>();
  private readonly pendingSleeps = new Map<string, Promise<void>>();
  private stopped = false;
  private readonly options: {
    idleMs: () => number | null;
    blocker: (botId: string) => IdleSleepBlocker | null | Promise<IdleSleepBlocker | null>;
    sleep: (botId: string, isCurrent: () => boolean) => Promise<boolean | void>;
    clock?: IdleSleepClock;
    blockedRetryMs?: number;
  };

  constructor(options: {
    idleMs: () => number | null;
    blocker: (botId: string) => IdleSleepBlocker | null | Promise<IdleSleepBlocker | null>;
    sleep: (botId: string, isCurrent: () => boolean) => Promise<boolean | void>;
    clock?: IdleSleepClock;
    blockedRetryMs?: number;
  }) {
    this.options = options;
  }

  private get clock(): IdleSleepClock { return this.options.clock ?? systemClock; }

  touch(botId: string): void {
    if (this.stopped || !botId) return;
    const idleMs = this.options.idleMs();
    if (idleMs === null) {
      this.cancel(botId);
      return;
    }
    const previous = this.entries.get(botId);
    if (previous?.timer) this.clock.clearTimeout(previous.timer);
    const entry: Entry = {
      generation: (previous?.generation ?? 0) + 1,
      deadlineAt: this.clock.now() + idleMs,
      timer: null,
      state: "idle",
    };
    this.entries.set(botId, entry);
    this.arm(botId, entry, idleMs);
  }

  reconcile(botIds: Iterable<string>): void {
    for (const botId of botIds) this.touch(botId);
  }

  cancel(botId: string): void {
    const entry = this.entries.get(botId);
    if (entry?.timer) this.clock.clearTimeout(entry.timer);
    if (entry) entry.generation += 1;
    this.entries.delete(botId);
  }

  beginManualSleep(botId: string): void {
    this.cancel(botId);
  }

  markManualSleepResult(botId: string, ok: boolean): void {
    if (this.stopped || this.options.idleMs() === null) return;
    this.entries.set(botId, {
      generation: 1,
      deadlineAt: this.clock.now(),
      timer: null,
      state: ok ? "sleep-requested" : "error",
    });
  }

  async waitForPendingSleep(botId: string): Promise<void> {
    const pending = this.pendingSleeps.get(botId);
    await pending;
  }

  status(botId: string): IdleSleepStatus {
    const idleMs = this.options.idleMs();
    if (idleMs === null) return { enabled: false, idleMs: null, state: "off", deadlineAt: null };
    const entry = this.entries.get(botId);
    if (!entry) return { enabled: true, idleMs, state: "idle", deadlineAt: null };
    return {
      enabled: true,
      idleMs,
      state: entry.state,
      deadlineAt: entry.state === "idle" || entry.state === "blocked" ? entry.deadlineAt : null,
      ...(entry.blocker ? { blocker: entry.blocker } : {}),
    };
  }

  shutdown(): void {
    this.stopped = true;
    for (const entry of this.entries.values()) {
      if (entry.timer) this.clock.clearTimeout(entry.timer);
      entry.generation += 1;
    }
    this.entries.clear();
  }

  private arm(botId: string, entry: Entry, delayMs: number): void {
    entry.timer = this.clock.setTimeout(() => void this.attempt(botId, entry), Math.max(0, delayMs));
  }

  private async attempt(botId: string, entry: Entry): Promise<void> {
    if (this.stopped || this.entries.get(botId) !== entry) return;
    entry.timer = null;
    entry.state = "checking";
    const generation = entry.generation;
    const isCurrent = () => !this.stopped && this.entries.get(botId) === entry && entry.generation === generation;
    try {
      const blocker = await this.options.blocker(botId);
      if (!isCurrent()) return;
      if (blocker) {
        const retryMs = Math.max(1_000, this.options.blockedRetryMs ?? 30_000);
        entry.state = "blocked";
        entry.blocker = blocker;
        entry.deadlineAt = this.clock.now() + retryMs;
        this.arm(botId, entry, retryMs);
        return;
      }
      entry.state = "sleeping";
      delete entry.blocker;
      const sleepPromise = Promise.resolve(this.options.sleep(botId, isCurrent))
        .then((slept) => {
          if (!isCurrent()) return;
          entry.state = slept === false ? "blocked" : "sleep-requested";
          if (slept === false) {
            // A final host-side recheck found new work. Treat that as activity,
            // giving it a complete idle window instead of racing it.
            this.touch(botId);
          }
        })
        .catch(() => {
          if (!isCurrent()) return;
          entry.state = "error";
          entry.deadlineAt = this.clock.now();
          // No timer: provider downtime must not create a billing/API loop.
        });
      this.pendingSleeps.set(botId, sleepPromise);
      await sleepPromise;
      if (this.pendingSleeps.get(botId) === sleepPromise) this.pendingSleeps.delete(botId);
    } catch {
      if (!isCurrent()) return;
      entry.state = "error";
      entry.deadlineAt = this.clock.now();
    }
  }
}
