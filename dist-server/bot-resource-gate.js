/**
 * Correlates the global provider event fan-in with the exact dispatch that the
 * server accepted for a thread. Canonical bot identity is insufficient after
 * a failed DELETE: the same bot is restored, but callbacks from its interrupted
 * pre-delete turn must remain permanently stale.
 */
export class TurnEventFence {
    states = new Map();
    begin(threadId, expectedTurnId) {
        if (!expectedTurnId)
            throw new Error("turn event correlation id required");
        const state = {
            generation: Symbol(threadId),
            phase: "preparing",
            turnId: expectedTurnId,
            providerReturned: false,
        };
        this.states.set(threadId, state);
        const ownsState = () => this.states.get(threadId) === state;
        return {
            markDispatching: () => {
                if (!ownsState() || state.phase !== "preparing")
                    return false;
                state.phase = "dispatching";
                return true;
            },
            bindReturnedTurnId: (turnId) => {
                if (!ownsState() || !turnId)
                    return false;
                if (state.turnId !== turnId)
                    return false;
                if (state.phase === "completed") {
                    this.states.delete(threadId);
                    return true;
                }
                if (state.phase === "accepted") {
                    state.providerReturned = true;
                    return true;
                }
                if (state.phase !== "dispatching")
                    return false;
                state.phase = "accepted";
                state.providerReturned = true;
                return true;
            },
            isCurrent: ownsState,
            invalidate: () => {
                if (ownsState())
                    this.states.delete(threadId);
            },
        };
    }
    /** The harness issues the id before any provider await, so an old callback
     * can never claim a replacement dispatch's open window. */
    accepts(threadId, type, turnId) {
        const state = this.states.get(threadId);
        if (!state || !turnId)
            return false;
        if (type === "turn.started" && state.phase === "dispatching") {
            if (state.turnId !== turnId)
                return false;
            state.phase = "accepted";
            return true;
        }
        return state.phase === "accepted" && state.turnId === turnId;
    }
    isAccepted(threadId, turnId) {
        const state = this.states.get(threadId);
        return state?.phase === "accepted" && state.turnId === turnId;
    }
    invalidate(threadId) {
        this.states.delete(threadId);
    }
    complete(threadId, turnId) {
        const state = this.states.get(threadId);
        if (state?.phase === "accepted" && state.turnId === turnId) {
            if (state.providerReturned)
                this.states.delete(threadId);
            else
                state.phase = "completed";
        }
    }
}
/** A stale provisioning callback may clean provider resources only after the
 * durable owner is gone. Any current owner (the original restored by rollback
 * or a replacement using the same id) wins over cleanup to avoid an ABA stop. */
export function shouldCleanupStaleProvision(currentOwner) {
    return currentOwner == null;
}
function deletionConflict(message) {
    return Object.assign(new Error(message), { status: 409 });
}
/**
 * A small per-bot reader/deleter gate for resources that live outside the bot
 * record itself. Admission is synchronous: once deletion begins, no upload or
 * file snapshot can enter, while deletion waits for already-admitted work.
 *
 * Node runs each synchronous section on one event loop, so the state change in
 * beginDeletion() is atomic with respect to acquire(). The returned barrier is
 * deliberately separate from the delete transaction so rollback can reopen a
 * bot without retaining stale lock state.
 */
export class BotResourceGate {
    states = new Map();
    createState(botId) {
        const state = {
            active: 0,
            detached: 0,
            deleting: false,
            generation: Symbol(botId),
        };
        this.states.set(botId, state);
        return state;
    }
    removeIdleState(botId, state) {
        if (!state.deleting && state.active === 0 && state.detached === 0 && this.states.get(botId) === state) {
            this.states.delete(botId);
        }
    }
    acquire(botId) {
        let state = this.states.get(botId);
        if (state?.deleting)
            throw deletionConflict("the bot is being deleted");
        if (!state)
            state = this.createState(botId);
        state.active += 1;
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            state.active -= 1;
            if (state.active !== 0)
                return;
            if (state.deleting) {
                const resolveIdle = state.resolveIdle;
                state.resolveIdle = undefined;
                resolveIdle?.();
            }
            else
                this.removeIdleState(botId, state);
        };
    }
    /**
     * Observe the current bot generation without making deletion wait for a
     * provider/network await. beginDeletion() invalidates the lease
     * synchronously; callers must check isCurrent() after every await and before
     * every provider send or durable side effect.
     */
    beginDetachedOperation(botId) {
        let state = this.states.get(botId);
        if (state?.deleting)
            throw deletionConflict("the bot is being deleted");
        if (!state)
            state = this.createState(botId);
        state.detached += 1;
        const generation = state.generation;
        let released = false;
        return {
            isCurrent: () => !released && !state.deleting && state.generation === generation && this.states.get(botId) === state,
            release: () => {
                if (released)
                    return;
                released = true;
                state.detached -= 1;
                this.removeIdleState(botId, state);
            },
        };
    }
    async run(botId, operation) {
        const release = this.acquire(botId);
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
    beginDeletion(botId) {
        let state = this.states.get(botId);
        if (state?.deleting)
            throw deletionConflict("the bot is already being deleted");
        if (!state)
            state = this.createState(botId);
        // Invalidate detached callbacks before the first await in the delete
        // transaction. A rollback reopens admission with this new generation;
        // pre-delete callbacks never become current again.
        state.generation = Symbol(botId);
        state.deleting = true;
        const idle = state.active === 0
            ? Promise.resolve()
            : new Promise((resolve) => {
                state.resolveIdle = resolve;
            });
        let released = false;
        return {
            idle,
            release: () => {
                if (released)
                    return;
                released = true;
                state.deleting = false;
                state.resolveIdle = undefined;
                this.removeIdleState(botId, state);
            },
        };
    }
    isDeleting(botId) {
        return this.states.get(botId)?.deleting === true;
    }
}
