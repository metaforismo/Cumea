export type RunLifecycleState = "working" | "waiting" | "no_signal" | "dead";
export type RunLifecycleAlertKind = "no_signal" | "dead" | "repeated_effect";

export interface RunLifecycleProjection {
  threadId: string;
  runId: string;
  state: RunLifecycleState;
  lastActivityAt: number;
  waitingSince?: number;
  reason?: string;
  repeatCount?: number;
}

export interface RunLifecycleAlert {
  threadId: string;
  runId: string;
  kind: RunLifecycleAlertKind;
  title: string;
  observedAt: number;
  signature?: string;
  repeatCount?: number;
}

export interface LifecycleWatchdogConfig {
  noSignalMs?: number;
  deadMs?: number;
  repeatWindowMs?: number;
  repeatThreshold?: number;
  maxThreads?: number;
}

export const LIFECYCLE_NO_SIGNAL_MS = 90_000;
export const LIFECYCLE_DEAD_MS = 5 * 60_000;
export const LIFECYCLE_REPEAT_WINDOW_MS = 2 * 60_000;
export const LIFECYCLE_REPEAT_THRESHOLD = 6;
const MAX_TRACKED_THREADS = 512;
const MAX_REASON_CHARS = 180;

interface TrackedLifecycle {
  threadId: string;
  runId: string;
  state: RunLifecycleState;
  lastActivityAt: number;
  waiting: Map<string, { since: number; reason: string }>;
  noSignalAlerted: boolean;
  deadAlerted: boolean;
  repeatSignature?: string;
  repeatDisplay?: string;
  repeatCount: number;
  repeatWindowStartedAt: number;
  repeatAlerted: boolean;
}

function boundedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_CHARS);
}

function effectKey(value: string): string {
  return boundedText(value).toLocaleLowerCase();
}

function projection(entry: TrackedLifecycle): RunLifecycleProjection {
  const waits = [...entry.waiting.values()].sort((a, b) => a.since - b.since);
  const waiting = waits[0];
  return {
    threadId: entry.threadId,
    runId: entry.runId,
    state: entry.state,
    lastActivityAt: entry.lastActivityAt,
    ...(waiting ? { waitingSince: waiting.since, reason: waiting.reason } : {}),
    ...(entry.repeatCount > 1 ? { repeatCount: entry.repeatCount } : {}),
  };
}

export class LifecycleWatchdog {
  private readonly noSignalMs: number;
  private readonly deadMs: number;
  private readonly repeatWindowMs: number;
  private readonly repeatThreshold: number;
  private readonly maxThreads: number;
  private readonly tracked = new Map<string, TrackedLifecycle>();

  constructor(config: LifecycleWatchdogConfig = {}) {
    this.noSignalMs = config.noSignalMs ?? LIFECYCLE_NO_SIGNAL_MS;
    this.deadMs = config.deadMs ?? LIFECYCLE_DEAD_MS;
    this.repeatWindowMs = config.repeatWindowMs ?? LIFECYCLE_REPEAT_WINDOW_MS;
    this.repeatThreshold = config.repeatThreshold ?? LIFECYCLE_REPEAT_THRESHOLD;
    this.maxThreads = config.maxThreads ?? MAX_TRACKED_THREADS;
    if (!(this.noSignalMs > 0 && this.deadMs > this.noSignalMs)) {
      throw new Error("lifecycle watchdog requires 0 < noSignalMs < deadMs");
    }
    if (!(this.repeatWindowMs > 0 && this.repeatThreshold >= 2)) {
      throw new Error("invalid lifecycle repeat detector configuration");
    }
    if (!Number.isInteger(this.maxThreads) || this.maxThreads < 1) {
      throw new Error("invalid lifecycle tracked-thread bound");
    }
  }

  start(threadId: string, runId: string, at = Date.now()): RunLifecycleProjection {
    if (!threadId || !runId || !Number.isFinite(at)) throw new Error("invalid lifecycle start");
    if (!this.tracked.has(threadId) && this.tracked.size >= this.maxThreads) {
      throw new Error("lifecycle watchdog thread bound reached");
    }
    const entry: TrackedLifecycle = {
      threadId,
      runId,
      state: "working",
      lastActivityAt: at,
      waiting: new Map(),
      noSignalAlerted: false,
      deadAlerted: false,
      repeatCount: 0,
      repeatWindowStartedAt: at,
      repeatAlerted: false,
    };
    this.tracked.set(threadId, entry);
    return projection(entry);
  }

  stop(threadId: string): void {
    this.tracked.delete(threadId);
  }

  get(threadId: string): RunLifecycleProjection | null {
    const entry = this.tracked.get(threadId);
    return entry ? projection(entry) : null;
  }

  signal(threadId: string, at = Date.now()): RunLifecycleProjection | null {
    const entry = this.tracked.get(threadId);
    if (!entry || !Number.isFinite(at)) return null;
    entry.lastActivityAt = Math.max(entry.lastActivityAt, at);
    entry.noSignalAlerted = false;
    entry.deadAlerted = false;
    entry.state = entry.waiting.size ? "waiting" : "working";
    return projection(entry);
  }

  openWait(threadId: string, requestId: string, reason: string, at = Date.now()): RunLifecycleProjection | null {
    const entry = this.tracked.get(threadId);
    if (!entry || !requestId || !Number.isFinite(at)) return null;
    entry.lastActivityAt = Math.max(entry.lastActivityAt, at);
    entry.noSignalAlerted = false;
    entry.deadAlerted = false;
    entry.waiting.set(requestId, { since: at, reason: boundedText(reason) || "Waiting for your input" });
    entry.state = "waiting";
    return projection(entry);
  }

  resolveWait(threadId: string, requestId: string, at = Date.now()): RunLifecycleProjection | null {
    const entry = this.tracked.get(threadId);
    if (!entry || !Number.isFinite(at)) return null;
    entry.waiting.delete(requestId);
    entry.lastActivityAt = Math.max(entry.lastActivityAt, at);
    entry.noSignalAlerted = false;
    entry.deadAlerted = false;
    entry.state = entry.waiting.size ? "waiting" : "working";
    return projection(entry);
  }

  recordEffect(threadId: string, title: string, at = Date.now()): RunLifecycleAlert | null {
    const entry = this.tracked.get(threadId);
    if (!entry || !Number.isFinite(at)) return null;
    this.signal(threadId, at);
    const display = boundedText(title);
    const signature = effectKey(display);
    if (!signature) return null;

    const sameWindow =
      entry.repeatSignature === signature &&
      at - entry.repeatWindowStartedAt <= this.repeatWindowMs;
    if (!sameWindow) {
      entry.repeatSignature = signature;
      entry.repeatDisplay = display;
      entry.repeatCount = 1;
      entry.repeatWindowStartedAt = at;
      entry.repeatAlerted = false;
      return null;
    }

    entry.repeatCount += 1;
    if (entry.repeatCount < this.repeatThreshold || entry.repeatAlerted) return null;
    entry.repeatAlerted = true;
    return {
      threadId: entry.threadId,
      runId: entry.runId,
      kind: "repeated_effect",
      title: `Repeated action detected: ${entry.repeatDisplay || "same tool"}`,
      observedAt: at,
      signature,
      repeatCount: entry.repeatCount,
    };
  }

  tick(at = Date.now()): { projections: RunLifecycleProjection[]; alerts: RunLifecycleAlert[] } {
    const projections: RunLifecycleProjection[] = [];
    const alerts: RunLifecycleAlert[] = [];
    for (const entry of this.tracked.values()) {
      if (entry.waiting.size) {
        entry.state = "waiting";
        projections.push(projection(entry));
        continue;
      }

      const silentFor = Math.max(0, at - entry.lastActivityAt);
      if (silentFor >= this.deadMs) {
        entry.state = "dead";
        if (!entry.deadAlerted) {
          entry.deadAlerted = true;
          alerts.push({
            threadId: entry.threadId,
            runId: entry.runId,
            kind: "dead",
            title: "Agent has produced no runtime signal for several minutes",
            observedAt: at,
          });
        }
      } else if (silentFor >= this.noSignalMs) {
        entry.state = "no_signal";
        if (!entry.noSignalAlerted) {
          entry.noSignalAlerted = true;
          alerts.push({
            threadId: entry.threadId,
            runId: entry.runId,
            kind: "no_signal",
            title: "Agent is still marked working but no runtime signal has arrived",
            observedAt: at,
          });
        }
      } else {
        entry.state = "working";
      }
      projections.push(projection(entry));
    }
    return { projections, alerts };
  }
}
