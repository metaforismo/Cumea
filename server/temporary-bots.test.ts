import { describe, expect, it, vi } from "vitest";

import type { BotRecord, Message } from "./store.ts";
import {
  TEMPORARY_BOT_DEFAULT_TTL_MINUTES,
  sweepTemporaryBots,
  isTemporaryBotCleanupEligible,
  temporaryBotCleanupBlockers,
  temporaryBotLifecycle,
} from "./temporary-bots.ts";

const NOW = 2_000_000_000_000;

function botFixture(patch: Partial<BotRecord> = {}): BotRecord {
  return {
    id: "bot-temp",
    threadId: "thread-temp",
    name: "Quick bot",
    title: "",
    description: "",
    notifications: true,
    color: "orange",
    avatar: { kind: "mote", shapeId: "drop", color: "#f56a16", motion: "playful" },
    unread: false,
    modelSelection: { instanceId: "test", model: "test" },
    resumeCursors: {},
    lifecycle: { kind: "temporary", expiresAt: NOW - 1 },
    createdAt: NOW - 86_400_000,
    ...patch,
  };
}

const workspace = () => ({ tasks: [] as Array<{ botId: string; status: string }>, runs: [] as Array<{ botId: string; status: string }>, routines: [] as Array<{ botId: string }> });

describe("temporary bot lifecycle", () => {
  it("creates an explicit bounded deadline and rejects ambiguous TTLs", () => {
    expect(temporaryBotLifecycle(undefined, NOW)).toEqual({
      kind: "temporary",
      expiresAt: NOW + TEMPORARY_BOT_DEFAULT_TTL_MINUTES * 60_000,
    });
    expect(temporaryBotLifecycle(60, NOW).expiresAt).toBe(NOW + 3_600_000);
    for (const invalid of [0, 14, 43_201, 1.5, "tomorrow", null]) {
      expect(() => temporaryBotLifecycle(invalid, NOW)).toThrow(/lifetime must be between/);
    }
  });

  it("keeps a bot for every active-work and approval boundary", () => {
    const due = botFixture({ busy: true });
    const active = workspace();
    active.tasks.push({ botId: due.id, status: "queued" });
    active.runs.push({ botId: due.id, status: "needs_attention" });
    active.routines.push({ botId: due.id });
    const messages: Message[] = [{
      id: "ask",
      role: "bot",
      kind: "options",
      at: NOW - 5,
      card: { title: "Approve?", subtitle: "Waiting", options: ["Allow", "Deny"], requestId: "request-1", requestType: "permission" },
    }];
    expect(temporaryBotCleanupBlockers({ bot: due, workspace: active, messages, hasActiveTurn: true, isPendingRequest: () => true, now: NOW })).toEqual([
      "bot-busy",
      "active-turn",
      "active-task",
      "active-run",
      "routine",
      "pending-approval",
    ]);
  });

  it("does not mistake onboarding or completed audit history for active work", () => {
    const due = botFixture();
    const settled = workspace();
    settled.tasks.push({ botId: due.id, status: "completed" });
    settled.runs.push({ botId: due.id, status: "failed" });
    const onboarding: Message[] = [{
      id: "onboarding",
      role: "bot",
      kind: "options",
      at: NOW - 10,
      card: { title: "What do you need?", subtitle: "Pick one", options: ["Research"] },
    }];
    expect(temporaryBotCleanupBlockers({ bot: due, workspace: settled, messages: onboarding, hasActiveTurn: false, isPendingRequest: () => false, now: NOW })).toEqual([]);
  });

  it("keeps a not-yet-expired bot and releases settled approvals after expiry", () => {
    const future = botFixture({ lifecycle: { kind: "temporary", expiresAt: NOW + 1 } });
    expect(temporaryBotCleanupBlockers({ bot: future, workspace: workspace(), messages: [], hasActiveTurn: false, isPendingRequest: () => false, now: NOW })).toEqual(["not-expired"]);
    const answered: Message[] = [{
      id: "ask",
      role: "bot",
      kind: "options",
      at: NOW - 5,
      card: { title: "Approve?", subtitle: "Done", options: ["Allow"], requestId: "request-1", answered: "Allow" },
    }];
    expect(temporaryBotCleanupBlockers({ bot: botFixture(), workspace: workspace(), messages: answered, hasActiveTurn: false, isPendingRequest: () => true, now: NOW })).toEqual([]);
  });

  it("revalidates stale sweeper candidates after Keep permanently wins the race", () => {
    const candidate = botFixture();
    const eligibility = () => isTemporaryBotCleanupEligible({
      bot: candidate,
      workspace: workspace(),
      messages: [],
      hasActiveTurn: false,
      isPendingRequest: () => false,
      now: NOW,
    });
    expect(eligibility()).toBe(true);
    delete candidate.lifecycle;
    expect(eligibility()).toBe(false);
  });

  it("does not let a stale provider card block cleanup after restart", () => {
    const stale: Message[] = [{
      id: "stale-ask",
      role: "bot",
      kind: "options",
      at: NOW - 5,
      card: { title: "Approve?", subtitle: "The provider restarted", options: ["Allow"], requestId: "request-stale" },
    }];
    expect(temporaryBotCleanupBlockers({
      bot: botFixture(),
      workspace: workspace(),
      messages: stale,
      hasActiveTurn: false,
      isPendingRequest: () => false,
      now: NOW,
    })).toEqual([]);
  });
});

describe("temporary bot sweeper", () => {
  it("removes only eligible due bots and isolates transaction failures", async () => {
    const eligible = botFixture({ id: "eligible", threadId: "eligible-thread" });
    const blocked = botFixture({ id: "blocked", threadId: "blocked-thread", busy: true });
    const future = botFixture({ id: "future", threadId: "future-thread", lifecycle: { kind: "temporary", expiresAt: NOW + 60_000 } });
    const broken = botFixture({ id: "broken", threadId: "broken-thread" });
    const permanent = botFixture({ id: "permanent", threadId: "permanent-thread", lifecycle: undefined });
    const remove = vi.fn(async (botId: string) => {
      if (botId === broken.id) throw new Error("transaction blocked");
    });

    const result = await sweepTemporaryBots({
      bots: () => [eligible, blocked, future, broken, permanent],
      workspace,
      messagesFor: () => [],
      hasActiveTurn: () => false,
      isPendingRequest: () => false,
      deleteBot: remove,
      now: NOW,
    });

    expect(remove.mock.calls.map(([id]) => id)).toEqual(["eligible", "broken"]);
    expect(result.removed).toEqual(["eligible"]);
    expect(result.skipped).toEqual([
      { botId: "blocked", blockers: ["bot-busy"] },
      { botId: "future", blockers: ["not-expired"] },
    ]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ botId: "broken", error: expect.any(Error) });
  });

  it("does not report removal when transactional revalidation declines a stale candidate", async () => {
    const candidate = botFixture({ id: "kept", threadId: "kept-thread" });
    const result = await sweepTemporaryBots({
      bots: () => [candidate],
      workspace,
      messagesFor: () => [],
      hasActiveTurn: () => false,
      isPendingRequest: () => false,
      deleteBot: async () => false,
      now: NOW,
    });
    expect(result.removed).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});
