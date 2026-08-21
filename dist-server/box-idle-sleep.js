const systemClock = {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        timer.unref?.();
        return timer;
    },
    clearTimeout: (handle) => clearTimeout(handle),
};
export class BoxIdleSleepManager {
    entries = new Map();
    pendingSleeps = new Map();
    stopped = false;
    options;
    constructor(options) {
        this.options = options;
    }
    get clock() { return this.options.clock ?? systemClock; }
    touch(botId) {
        if (this.stopped || !botId)
            return;
        const idleMs = this.options.idleMs();
        if (idleMs === null) {
            this.cancel(botId);
            return;
        }
        const previous = this.entries.get(botId);
        if (previous?.timer)
            this.clock.clearTimeout(previous.timer);
        const entry = {
            generation: (previous?.generation ?? 0) + 1,
            deadlineAt: this.clock.now() + idleMs,
            timer: null,
            state: "idle",
        };
        this.entries.set(botId, entry);
        this.arm(botId, entry, idleMs);
    }
    reconcile(botIds) {
        for (const botId of botIds)
            this.touch(botId);
    }
    cancel(botId) {
        const entry = this.entries.get(botId);
        if (entry?.timer)
            this.clock.clearTimeout(entry.timer);
        if (entry)
            entry.generation += 1;
        this.entries.delete(botId);
    }
    beginManualSleep(botId) {
        this.cancel(botId);
    }
    markManualSleepResult(botId, ok) {
        if (this.stopped || this.options.idleMs() === null)
            return;
        this.entries.set(botId, {
            generation: 1,
            deadlineAt: this.clock.now(),
            timer: null,
            state: ok ? "sleep-requested" : "error",
        });
    }
    async waitForPendingSleep(botId) {
        const pending = this.pendingSleeps.get(botId);
        await pending;
    }
    status(botId) {
        const idleMs = this.options.idleMs();
        if (idleMs === null)
            return { enabled: false, idleMs: null, state: "off", deadlineAt: null };
        const entry = this.entries.get(botId);
        if (!entry)
            return { enabled: true, idleMs, state: "idle", deadlineAt: null };
        return {
            enabled: true,
            idleMs,
            state: entry.state,
            deadlineAt: entry.state === "idle" || entry.state === "blocked" ? entry.deadlineAt : null,
            ...(entry.blocker ? { blocker: entry.blocker } : {}),
        };
    }
    shutdown() {
        this.stopped = true;
        for (const entry of this.entries.values()) {
            if (entry.timer)
                this.clock.clearTimeout(entry.timer);
            entry.generation += 1;
        }
        this.entries.clear();
    }
    arm(botId, entry, delayMs) {
        entry.timer = this.clock.setTimeout(() => void this.attempt(botId, entry), Math.max(0, delayMs));
    }
    async attempt(botId, entry) {
        if (this.stopped || this.entries.get(botId) !== entry)
            return;
        entry.timer = null;
        entry.state = "checking";
        const generation = entry.generation;
        const isCurrent = () => !this.stopped && this.entries.get(botId) === entry && entry.generation === generation;
        try {
            const blocker = await this.options.blocker(botId);
            if (!isCurrent())
                return;
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
                if (!isCurrent())
                    return;
                entry.state = slept === false ? "blocked" : "sleep-requested";
                if (slept === false) {
                    // A final host-side recheck found new work. Treat that as activity,
                    // giving it a complete idle window instead of racing it.
                    this.touch(botId);
                }
            })
                .catch(() => {
                if (!isCurrent())
                    return;
                entry.state = "error";
                entry.deadlineAt = this.clock.now();
                // No timer: provider downtime must not create a billing/API loop.
            });
            this.pendingSleeps.set(botId, sleepPromise);
            await sleepPromise;
            if (this.pendingSleeps.get(botId) === sleepPromise)
                this.pendingSleeps.delete(botId);
        }
        catch {
            if (!isCurrent())
                return;
            entry.state = "error";
            entry.deadlineAt = this.clock.now();
        }
    }
}
