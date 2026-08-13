import type { BotLifecycle, BotRecord, Message } from "./store.ts";

export const TEMPORARY_BOT_DEFAULT_TTL_MINUTES = 24 * 60;
export const TEMPORARY_BOT_MIN_TTL_MINUTES = 15;
export const TEMPORARY_BOT_MAX_TTL_MINUTES = 30 * 24 * 60;

export type TemporaryBotCleanupBlocker =
  | "not-expired"
  | "bot-busy"
  | "active-turn"
  | "active-task"
  | "active-run"
  | "routine"
  | "pending-approval";

interface CleanupWorkspace {
  tasks: readonly { botId: string; status: string }[];
  runs: readonly { botId: string; status: string }[];
  routines: readonly { botId: string }[];
}

export function temporaryBotLifecycle(ttlMinutes: unknown, now = Date.now()): BotLifecycle {
  const value = ttlMinutes === undefined ? TEMPORARY_BOT_DEFAULT_TTL_MINUTES : ttlMinutes;
  if (typeof value !== "number") {
    throw Object.assign(
      new Error(
        `temporary bot lifetime must be between ${TEMPORARY_BOT_MIN_TTL_MINUTES} minutes and ${TEMPORARY_BOT_MAX_TTL_MINUTES} minutes`,
      ),
      { status: 400 },
    );
  }
  if (!Number.isInteger(value) || value < TEMPORARY_BOT_MIN_TTL_MINUTES || value > TEMPORARY_BOT_MAX_TTL_MINUTES) {
    throw Object.assign(
      new Error(
        `temporary bot lifetime must be between ${TEMPORARY_BOT_MIN_TTL_MINUTES} minutes and ${TEMPORARY_BOT_MAX_TTL_MINUTES} minutes`,
      ),
      { status: 400 },
    );
  }
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("invalid temporary bot clock");
  const expiresAt = now + value * 60_000;
  if (!Number.isSafeInteger(expiresAt)) throw Object.assign(new Error("temporary bot lifetime is too large"), { status: 400 });
  return { kind: "temporary", expiresAt };
}

/** Explain why a due temporary bot cannot yet be removed.
 *
 * Any routine blocks cleanup, including a paused one: deleting it silently
 * would discard intentional future configuration. Completed task/run audit is
 * allowed to expire with the explicitly temporary bot, while queued, running,
 * and needs-attention work keeps the bot alive until it settles.
 */
export function temporaryBotCleanupBlockers(input: {
  bot: BotRecord;
  workspace: CleanupWorkspace;
  messages: readonly Message[];
  hasActiveTurn: boolean;
  isPendingRequest: (requestId: string) => boolean;
  now?: number;
}): TemporaryBotCleanupBlocker[] {
  const { bot, workspace, messages, hasActiveTurn } = input;
  const now = input.now ?? Date.now();
  if (!bot.lifecycle || bot.lifecycle.kind !== "temporary") return [];

  const blockers: TemporaryBotCleanupBlocker[] = [];
  if (now < bot.lifecycle.expiresAt) blockers.push("not-expired");
  if (bot.busy) blockers.push("bot-busy");
  if (hasActiveTurn) blockers.push("active-turn");
  if (workspace.tasks.some((task) =>
    task.botId === bot.id && ["queued", "running", "needs_attention"].includes(task.status)
  )) blockers.push("active-task");
  if (workspace.runs.some((run) =>
    run.botId === bot.id && ["running", "needs_attention"].includes(run.status)
  )) blockers.push("active-run");
  if (workspace.routines.some((routine) => routine.botId === bot.id)) blockers.push("routine");
  if (messages.some((message) => {
    const requestId = message.card?.requestId;
    return message.kind === "options"
      && Boolean(requestId)
      && !message.card?.answered
      && !message.card?.dismissed
      && input.isPendingRequest(requestId!);
  })) blockers.push("pending-approval");
  return blockers;
}

export function isTemporaryBotCleanupEligible(input: Parameters<typeof temporaryBotCleanupBlockers>[0]): boolean {
  return input.bot.lifecycle?.kind === "temporary" && temporaryBotCleanupBlockers(input).length === 0;
}

export interface TemporaryBotSweepResult {
  removed: string[];
  skipped: Array<{ botId: string; blockers: TemporaryBotCleanupBlocker[] }>;
  failed: Array<{ botId: string; error: unknown }>;
}

/** Testable scheduler core. Callers inject the canonical transactional delete
 * operation; a failure for one bot never prevents the rest of the fleet from
 * being evaluated. */
export async function sweepTemporaryBots(input: {
  bots: () => readonly BotRecord[];
  workspace: () => CleanupWorkspace;
  messagesFor: (threadId: string) => readonly Message[];
  hasActiveTurn: (threadId: string) => boolean;
  isPendingRequest: (threadId: string, requestId: string) => boolean;
  deleteBot: (botId: string) => boolean | void | Promise<boolean | void>;
  now?: number;
}): Promise<TemporaryBotSweepResult> {
  const now = input.now ?? Date.now();
  const result: TemporaryBotSweepResult = { removed: [], skipped: [], failed: [] };
  const candidates = [...input.bots()].filter((bot) => bot.lifecycle?.kind === "temporary");
  for (const bot of candidates) {
    const blockers = temporaryBotCleanupBlockers({
      bot,
      workspace: input.workspace(),
      messages: input.messagesFor(bot.threadId),
      hasActiveTurn: input.hasActiveTurn(bot.threadId),
      isPendingRequest: (requestId) => input.isPendingRequest(bot.threadId, requestId),
      now,
    });
    if (blockers.length) {
      result.skipped.push({ botId: bot.id, blockers });
      continue;
    }
    try {
      const deleted = await input.deleteBot(bot.id);
      if (deleted !== false) result.removed.push(bot.id);
    } catch (error) {
      result.failed.push({ botId: bot.id, error });
    }
  }
  return result;
}
