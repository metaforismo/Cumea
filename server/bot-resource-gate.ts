interface BotResourceState {
  active: number;
  /** Detached provider operations do not block deletion. They keep the state
   * alive only long enough for a generation change to cancel their callbacks. */
  detached: number;
  deleting: boolean;
  generation: symbol;
  resolveIdle?: () => void;
}

export interface BotDeletionBarrier {
  /** Resolves only after every operation admitted before deletion has left. */
  idle: Promise<void>;
  /** Reopens the gate after a failed delete, or forgets it after success. */
  release: () => void;
}

export interface BotDetachedOperation {
  /** False as soon as deletion starts, including after a deletion rollback. */
  isCurrent: () => boolean;
  release: () => void;
}

export interface TurnEventAdmission {
  /** Opens the very small synchronous window in which the provider's own
   * turn.started event may claim this dispatch. */
  markDispatching: () => boolean;
  /** Confirms providers that return their turn id without first emitting it. */
  bindReturnedTurnId: (turnId: string) => boolean;
  isCurrent: () => boolean;
  invalidate: () => void;
}

interface TurnEventState {
  generation: symbol;
  phase: "preparing" | "dispatching" | "accepted" | "completed";
  turnId?: string;
  providerReturned: boolean;
}

/**
 * Correlates the global provider event fan-in with the exact dispatch that the
 * server accepted for a thread. Canonical bot identity is insufficient after
 * a failed DELETE: the same bot is restored, but callbacks from its interrupted
 * pre-delete turn must remain permanently stale.
 */
export class TurnEventFence {
  private readonly states = new Map<string, TurnEventState>();

  begin(threadId: string, expectedTurnId: string): TurnEventAdmission {
    if (!expectedTurnId) throw new Error("turn event correlation id required");
    const state: TurnEventState = {
      generation: Symbol(threadId),
      phase: "preparing",
      turnId: expectedTurnId,
      providerReturned: false,
    };
    this.states.set(threadId, state);
    const ownsState = () => this.states.get(threadId) === state;
    return {
      markDispatching: () => {
        if (!ownsState() || state.phase !== "preparing") return false;
        state.phase = "dispatching";
        return true;
      },
      bindReturnedTurnId: (turnId) => {
        if (!ownsState() || !turnId) return false;
        if (state.turnId !== turnId) return false;
        if (state.phase === "completed") {
          this.states.delete(threadId);
          return true;
        }
        if (state.phase === "accepted") {
          state.providerReturned = true;
          return true;
        }
        if (state.phase !== "dispatching") return false;
        state.phase = "accepted";
        state.providerReturned = true;
        return true;
      },
      isCurrent: ownsState,
      invalidate: () => {
        if (ownsState()) this.states.delete(threadId);
      },
    };
  }

  /** The harness issues the id before any provider await, so an old callback
   * can never claim a replacement dispatch's open window. */
  accepts(threadId: string, type: string, turnId?: string): boolean {
    const state = this.states.get(threadId);
    if (!state || !turnId) return false;
    if (type === "turn.started" && state.phase === "dispatching") {
      if (state.turnId !== turnId) return false;
      state.phase = "accepted";
      return true;
    }
    return state.phase === "accepted" && state.turnId === turnId;
  }

  isAccepted(threadId: string, turnId: string): boolean {
    const state = this.states.get(threadId);
    return state?.phase === "accepted" && state.turnId === turnId;
  }

  invalidate(threadId: string): void {
    this.states.delete(threadId);
  }

  complete(threadId: string, turnId?: string): void {
    const state = this.states.get(threadId);
    if (state?.phase === "accepted" && state.turnId === turnId) {
      if (state.providerReturned) this.states.delete(threadId);
      else state.phase = "completed";
    }
  }
}

/** A stale provisioning callback may clean provider resources only after the
 * durable owner is gone. Any current owner (the original restored by rollback
 * or a replacement using the same id) wins over cleanup to avoid an ABA stop. */
export function shouldCleanupStaleProvision(currentOwner: unknown): boolean {
  return currentOwner == null;
}

function deletionConflict(message: string): Error {
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
  private readonly states = new Map<string, BotResourceState>();

  private createState(botId: string): BotResourceState {
    const state = {
      active: 0,
      detached: 0,
      deleting: false,
      generation: Symbol(botId),
    };
    this.states.set(botId, state);
    return state;
  }

  private removeIdleState(botId: string, state: BotResourceState) {
    if (!state.deleting && state.active === 0 && state.detached === 0 && this.states.get(botId) === state) {
      this.states.delete(botId);
    }
  }

  acquire(botId: string): () => void {
    let state = this.states.get(botId);
    if (state?.deleting) throw deletionConflict("the bot is being deleted");
    if (!state) state = this.createState(botId);
    state.active += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      state!.active -= 1;
      if (state!.active !== 0) return;
      if (state!.deleting) {
        const resolveIdle = state!.resolveIdle;
        state!.resolveIdle = undefined;
        resolveIdle?.();
      } else this.removeIdleState(botId, state!);
    };
  }

  /**
   * Observe the current bot generation without making deletion wait for a
   * provider/network await. beginDeletion() invalidates the lease
   * synchronously; callers must check isCurrent() after every await and before
   * every provider send or durable side effect.
   */
  beginDetachedOperation(botId: string): BotDetachedOperation {
    let state = this.states.get(botId);
    if (state?.deleting) throw deletionConflict("the bot is being deleted");
    if (!state) state = this.createState(botId);
    state.detached += 1;
    const generation = state.generation;
    let released = false;
    return {
      isCurrent: () => !released && !state!.deleting && state!.generation === generation && this.states.get(botId) === state,
      release: () => {
        if (released) return;
        released = true;
        state!.detached -= 1;
        this.removeIdleState(botId, state!);
      },
    };
  }

  async run<T>(botId: string, operation: () => T | Promise<T>): Promise<T> {
    const release = this.acquire(botId);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  beginDeletion(botId: string): BotDeletionBarrier {
    let state = this.states.get(botId);
    if (state?.deleting) throw deletionConflict("the bot is already being deleted");
    if (!state) state = this.createState(botId);
    // Invalidate detached callbacks before the first await in the delete
    // transaction. A rollback reopens admission with this new generation;
    // pre-delete callbacks never become current again.
    state.generation = Symbol(botId);
    state.deleting = true;

    const idle = state.active === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          state!.resolveIdle = resolve;
        });
    let released = false;
    return {
      idle,
      release: () => {
        if (released) return;
        released = true;
        state!.deleting = false;
        state!.resolveIdle = undefined;
        this.removeIdleState(botId, state!);
      },
    };
  }

  isDeleting(botId: string): boolean {
    return this.states.get(botId)?.deleting === true;
  }
}
