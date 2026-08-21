import { describe, expect, it } from "vitest";

import { dismissOrphanedApprovals, type ApprovalReconciliationStore } from "./approval-reconciliation.ts";
import type { Message } from "./store.ts";

function fakeStore(threads: Record<string, Message[]>) {
  const patches: Array<{ threadId: string; messageId: string; card: Message["card"] }> = [];
  const store: ApprovalReconciliationStore = {
    messagesFor: (threadId) => threads[threadId] ?? [],
    patchMessage: (threadId, messageId, patch) => {
      const list = threads[threadId] ?? [];
      const message = list.find((m) => m.id === messageId);
      if (!message) return null;
      Object.assign(message, patch);
      patches.push({ threadId, messageId, card: message.card });
      return message;
    },
  };
  return { store, patches };
}

const card = (overrides: Partial<Message["card"]> = {}): NonNullable<Message["card"]> => ({
  title: "Run shell command",
  subtitle: "rm -rf scratch",
  options: ["Allow", "Deny"],
  ...overrides,
});

describe("dismissOrphanedApprovals", () => {
  it("returns empty when every card is already resolved", () => {
    const { store, patches } = fakeStore({
      t1: [
        { id: "m1", role: "bot", kind: "options", at: 1, card: card({ answered: "allow" }) },
        { id: "m2", role: "bot", kind: "options", at: 2, card: card({ dismissed: true }) },
        { id: "m3", role: "bot", kind: "text", at: 3, text: "no card here" },
      ],
    });
    expect(dismissOrphanedApprovals([{ threadId: "t1" }], store)).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("dismisses only open cards and reports what it touched", () => {
    const open = { id: "m2", role: "bot" as const, kind: "options" as const, at: 2, card: card() };
    const { store, patches } = fakeStore({
      t1: [
        { id: "m1", role: "bot", kind: "options", at: 1, card: card({ answered: "deny" }) },
        open,
      ],
      t2: [{ id: "m9", role: "bot", kind: "options", at: 9, card: card() }],
    });
    const result = dismissOrphanedApprovals([{ threadId: "t1" }, { threadId: "t2" }], store);
    expect(result).toEqual([
      { threadId: "t1", messageId: "m2" },
      { threadId: "t2", messageId: "m9" },
    ]);
    expect(patches).toHaveLength(2);
    expect(open.card).toMatchObject({ dismissed: true });
    expect(open.card!.answered).toBeUndefined();
  });

  it("tolerates a patch that comes back null", () => {
    const store: ApprovalReconciliationStore = {
      messagesFor: () => [{ id: "m1", role: "bot", kind: "options", at: 1, card: card() }],
      patchMessage: () => null,
    };
    expect(dismissOrphanedApprovals([{ threadId: "t1" }], store)).toEqual([]);
  });

  it("handles unknown threads without throwing", () => {
    const { store } = fakeStore({});
    expect(dismissOrphanedApprovals([{ threadId: "ghost" }], store)).toEqual([]);
  });
});
