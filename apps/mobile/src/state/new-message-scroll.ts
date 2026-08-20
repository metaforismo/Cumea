export const NEWEST_EDGE_THRESHOLD_PX = 80;
export const MAX_HIDDEN_NEWER_COUNT = 999;

export interface NewMessageScrollState {
  latestMessageId: string | null;
  atNewestEdge: boolean;
  hiddenNewerCount: number;
}

export interface NewMessageObservation {
  state: NewMessageScrollState;
  shouldJumpToNewest: boolean;
}

function boundedCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_HIDDEN_NEWER_COUNT, Math.floor(value));
}

export function initialNewMessageScrollState(messageIds: readonly string[]): NewMessageScrollState {
  return {
    latestMessageId: messageIds.at(-1) ?? null,
    atNewestEdge: true,
    hiddenNewerCount: 0,
  };
}

/**
 * An inverted FlatList uses offset 0 for the newest edge. Negative offsets can
 * occur during iOS bounce and still count as being at the edge.
 */
export function isAtNewestEdge(offsetY: number, thresholdPx = NEWEST_EDGE_THRESHOLD_PX): boolean {
  if (!Number.isFinite(offsetY)) return false;
  if (!Number.isFinite(thresholdPx) || thresholdPx < 0) return false;
  return offsetY <= thresholdPx;
}

export function updateNewestEdge(
  current: NewMessageScrollState,
  offsetY: number,
  thresholdPx = NEWEST_EDGE_THRESHOLD_PX,
): NewMessageScrollState {
  const atNewestEdge = isAtNewestEdge(offsetY, thresholdPx);
  return {
    ...current,
    atNewestEdge,
    hiddenNewerCount: atNewestEdge ? 0 : current.hiddenNewerCount,
  };
}

/**
 * Reconcile the ordered canonical message IDs currently mounted for one agent.
 *
 * - Initial hydration/resnapshot never manufactures a "new messages" count.
 * - If the previously observed latest ID is no longer present, the list was
 *   reset/reconciled and we re-anchor without guessing how many rows are new.
 * - Only IDs appended after the previous latest count as new.
 * - Settled/streaming updates that keep the same latest ID do not increment.
 */
export function observeMessageIds(
  current: NewMessageScrollState,
  messageIds: readonly string[],
): NewMessageObservation {
  const nextLatest = messageIds.at(-1) ?? null;
  if (!nextLatest || nextLatest === current.latestMessageId) {
    return { state: current, shouldJumpToNewest: false };
  }

  if (!current.latestMessageId) {
    return {
      state: { ...current, latestMessageId: nextLatest, hiddenNewerCount: 0 },
      shouldJumpToNewest: false,
    };
  }

  const previousIndex = messageIds.lastIndexOf(current.latestMessageId);
  if (previousIndex < 0) {
    return {
      state: { ...current, latestMessageId: nextLatest, hiddenNewerCount: 0 },
      shouldJumpToNewest: false,
    };
  }

  const appended = messageIds.length - previousIndex - 1;
  if (appended <= 0) {
    return {
      state: { ...current, latestMessageId: nextLatest },
      shouldJumpToNewest: false,
    };
  }

  if (current.atNewestEdge) {
    return {
      state: { ...current, latestMessageId: nextLatest, hiddenNewerCount: 0 },
      shouldJumpToNewest: true,
    };
  }

  return {
    state: {
      ...current,
      latestMessageId: nextLatest,
      hiddenNewerCount: boundedCount(current.hiddenNewerCount + appended),
    },
    shouldJumpToNewest: false,
  };
}

export function acknowledgeNewest(current: NewMessageScrollState): NewMessageScrollState {
  return { ...current, atNewestEdge: true, hiddenNewerCount: 0 };
}
