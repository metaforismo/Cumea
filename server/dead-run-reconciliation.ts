// The lifecycle watchdog is a pure projector: it says a run looks dead but
// never settles anything. The decision to actually reconcile a dead run
// lives here so it can be tested without the harness. Two consecutive dead
// ticks are required — a single spurious projection (clock hiccup, one
// missed signal burst) must not fail a live-but-slow run.

/** Consecutive dead ticks required before a run is settled as failed. */
export const DEAD_RUN_SETTLE_TICKS = 2;

export interface DeadRunTickInput {
  /** Consecutive dead ticks already counted for this run before this one. */
  deadTicks: number;
  /** Whether the current watchdog tick again projected the run as dead. */
  tick: boolean;
  /** Consecutive dead ticks required before settling. Defaults to
   * {@link DEAD_RUN_SETTLE_TICKS}. */
  requiredTicks?: number;
}

export interface DeadRunDecision {
  /** True once the run has been dead for the required consecutive ticks. */
  settle: boolean;
  /** Consecutive dead-tick count after this tick (0 when it recovered). */
  deadTicks: number;
}

export function decideDeadReconciliation({ deadTicks, tick, requiredTicks = DEAD_RUN_SETTLE_TICKS }: DeadRunTickInput): DeadRunDecision {
  const prior = Number.isFinite(deadTicks) ? Math.max(0, Math.floor(deadTicks)) : 0;
  const next = tick ? prior + 1 : 0;
  return { settle: next >= requiredTicks, deadTicks: next };
}
