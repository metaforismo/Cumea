export interface ChronologicalEntity {
  id: string;
  createdAt: number;
}

export interface AgentMessagePaging {
  cursor: string | null;
  initialized: boolean;
  hasMore: boolean;
  loading: boolean;
}

export const UNINITIALIZED_MESSAGE_PAGING: AgentMessagePaging = {
  cursor: null,
  initialized: false,
  hasMore: false,
  loading: false,
};

export function pagingAfterPage(
  current: AgentMessagePaging | undefined,
  nextCursor: string | null,
  initialize: boolean,
): AgentMessagePaging {
  return {
    cursor: nextCursor,
    initialized: initialize || current?.initialized === true,
    hasMore: nextCursor !== null,
    loading: false,
  };
}

export function mergeChronological<T extends ChronologicalEntity>(
  previous: readonly T[],
  incoming: readonly T[],
  reconcile: (existing: T, next: T) => T = (_existing, next) => next,
): T[] {
  const byId = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? reconcile(existing, item) : item);
  }
  return [...byId.values()].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt - right.createdAt,
  );
}

export interface BranchEntity extends ChronologicalEntity {
  parentId?: string | null;
  role?: string;
  kind?: string;
  delivery?: "queued" | "sent" | "cancelled" | "failed";
}

/** Returns only the root-to-leaf path selected by the host. Malformed or
 * cyclic parent data fails closed at the first repeated/missing ancestor. */
export function visibleBranch<T extends BranchEntity>(
  messages: readonly T[],
  activeLeafId?: string | null,
): T[] {
  if (!messages.length) return [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  const path: T[] = [];
  const visited = new Set<string>();
  let current = byId.get(activeLeafId ?? messages.at(-1)?.id ?? "");
  while (current && !visited.has(current.id)) {
    path.push(current);
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

/** Sibling revisions of one message, ordered deterministically for version
 * navigation. The original message and every edit share the same parent. */
export function branchVersions<T extends BranchEntity>(messages: readonly T[], message: T): T[] {
  return messages
    .filter((candidate) =>
      (candidate.parentId ?? null) === (message.parentId ?? null)
      && candidate.role === message.role
      && candidate.kind === message.kind
      && candidate.delivery !== "queued"
      && candidate.delivery !== "cancelled"
      && candidate.delivery !== "failed",
    )
    .sort((left, right) => left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt - right.createdAt);
}

/** Select the newest descendant of a version so switching a user revision
 * restores its complete answer path rather than stopping at the user row. */
export function newestBranchLeaf<T extends BranchEntity>(messages: readonly T[], messageId: string): string | null {
  if (!messages.some((message) => message.id === messageId)) return null;
  const visited = new Set<string>();
  let current = messageId;
  while (!visited.has(current)) {
    visited.add(current);
    const children = messages.filter((message) => message.parentId === current && !visited.has(message.id));
    if (!children.length) break;
    current = children.reduce((latest, candidate) => candidate.createdAt > latest.createdAt
      || (candidate.createdAt === latest.createdAt && candidate.id.localeCompare(latest.id) > 0)
      ? candidate
      : latest).id;
  }
  return current;
}

type TimerHandle = ReturnType<typeof setTimeout>;
type Schedule = (callback: () => void, delayMs: number) => TimerHandle;
type Cancel = (handle: TimerHandle) => void;

/**
 * Coalesces high-frequency text deltas into one store write. It intentionally
 * has no React Native dependency so ordering and boundary flushes stay easy to
 * test in isolation.
 */
export class StreamDeltaBatcher {
  private readonly pending = new Map<string, string>();
  private timer: TimerHandle | null = null;
  private readonly onFlush: (deltas: Readonly<Record<string, string>>) => void;
  private readonly delayMs: number;
  private readonly schedule: Schedule;
  private readonly cancel: Cancel;

  constructor(
    onFlush: (deltas: Readonly<Record<string, string>>) => void,
    delayMs = 40,
    schedule: Schedule = (callback, delay) => setTimeout(callback, delay),
    cancel: Cancel = (handle) => clearTimeout(handle),
  ) {
    this.onFlush = onFlush;
    this.delayMs = delayMs;
    this.schedule = schedule;
    this.cancel = cancel;
  }

  append(agentId: string, delta: string): void {
    if (!delta) return;
    this.pending.set(agentId, `${this.pending.get(agentId) ?? ""}${delta}`);
    if (this.timer !== null) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.flush();
    }, this.delayMs);
  }

  flush(agentId?: string): void {
    const batch: Record<string, string> = {};
    if (agentId) {
      const delta = this.pending.get(agentId);
      if (delta) batch[agentId] = delta;
      this.pending.delete(agentId);
    } else {
      for (const [id, delta] of this.pending) batch[id] = delta;
      this.pending.clear();
    }

    if (this.pending.size === 0 && this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (Object.keys(batch).length > 0) this.onFlush(batch);
  }

  clear(agentId?: string): void {
    if (agentId) this.pending.delete(agentId);
    else this.pending.clear();
    if (this.pending.size === 0 && this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }
}
