import type { Message } from "./store.ts";

export interface ReconciledApproval {
  threadId: string;
  messageId: string;
}

export interface ApprovalReconciliationStore {
  messagesFor(threadId: string): Message[];
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null;
}

/** Approval cards left open by a previous process can never be answered:
 * their owning driver died with the harness, and the in-memory request map
 * died with it. Dismiss them at startup so transcripts do not show a live
 * question the app would 409 on. */
export function dismissOrphanedApprovals(
  threads: readonly { threadId: string }[],
  store: ApprovalReconciliationStore,
): ReconciledApproval[] {
  const reconciled: ReconciledApproval[] = [];
  for (const { threadId } of threads) {
    for (const message of store.messagesFor(threadId)) {
      if (!message.card || message.card.answered || message.card.dismissed) continue;
      const patched = store.patchMessage(threadId, message.id, {
        card: { ...message.card, dismissed: true },
      });
      if (patched) reconciled.push({ threadId, messageId: message.id });
    }
  }
  return reconciled;
}
