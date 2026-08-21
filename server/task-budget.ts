export const TASK_BUDGET_KEYS = ["durationMs", "toolCalls", "computerActions", "delegations", "tokens"] as const;
export type TaskBudgetKey = typeof TASK_BUDGET_KEYS[number];

export interface TaskBudget {
  durationMs?: number;
  toolCalls?: number;
  computerActions?: number;
  delegations?: number;
  tokens?: number;
}

export type BudgetMetric = Exclude<TaskBudgetKey, "durationMs">;
export interface TaskBudgetUsage {
  startedAt: number;
  activeSince?: number;
  durationUsedMs: number;
  toolCalls: number;
  computerActions: number;
  delegations: number;
  /** Absent until two canonical cumulative snapshots establish a delta. */
  tokens?: number;
  tokenBaseline?: { providerInstanceId: string; model: string; input: number; output: number };
  tokenLatest?: { providerInstanceId: string; model: string; input: number; output: number };
  exhaustedAt?: number;
  exhaustionReason?: TaskBudgetKey;
}

const BOUNDS: Record<TaskBudgetKey, readonly [number, number]> = {
  durationMs: [1_000, 7 * 24 * 60 * 60_000],
  toolCalls: [1, 100_000],
  computerActions: [1, 100_000],
  delegations: [1, 1_000],
  tokens: [1, 100_000_000],
};
const USAGE_KEYS = new Set([
  "startedAt", "activeSince", "durationUsedMs", "toolCalls", "computerActions", "delegations", "tokens",
  "tokenBaseline", "tokenLatest", "exhaustedAt", "exhaustionReason",
]);
const MAX_TIMESTAMP = Date.UTC(2100, 0, 1);

function validTokenSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 4 && Object.keys(row).every((key) => ["providerInstanceId", "model", "input", "output"].includes(key)) &&
    typeof row.providerInstanceId === "string" && /^[\w.-]{1,100}$/.test(row.providerInstanceId) &&
    typeof row.model === "string" && row.model.length > 0 && row.model.length <= 200 &&
    Number.isSafeInteger(row.input) && Number(row.input) >= 0 && Number(row.input) <= 1_000_000_000 &&
    Number.isSafeInteger(row.output) && Number(row.output) >= 0 && Number(row.output) <= 1_000_000_000;
}

/** Strict durable decoder used when reopening local state. */
export function validTaskBudgetUsage(value: unknown): value is TaskBudgetUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !USAGE_KEYS.has(key))) return false;
  const timestamp = (item: unknown) => Number.isSafeInteger(item) && Number(item) > 0 && Number(item) <= MAX_TIMESTAMP;
  if (!timestamp(row.startedAt) || !Number.isSafeInteger(row.durationUsedMs) || Number(row.durationUsedMs) < 0 || Number(row.durationUsedMs) > 1_000_000_000_000) return false;
  for (const key of ["toolCalls", "computerActions", "delegations"] as const) {
    if (!Number.isSafeInteger(row[key]) || Number(row[key]) < 0 || Number(row[key]) > 100_000_000) return false;
  }
  if (row.tokens !== undefined && (!Number.isSafeInteger(row.tokens) || Number(row.tokens) < 0 || Number(row.tokens) > 1_000_000_000)) return false;
  if (row.activeSince !== undefined && (!timestamp(row.activeSince) || Number(row.activeSince) < Number(row.startedAt) || row.exhaustedAt !== undefined)) return false;
  if ((row.exhaustedAt === undefined) !== (row.exhaustionReason === undefined)) return false;
  if (row.exhaustedAt !== undefined && (!timestamp(row.exhaustedAt) || Number(row.exhaustedAt) < Number(row.startedAt))) return false;
  if (row.exhaustionReason !== undefined && !(TASK_BUDGET_KEYS as readonly unknown[]).includes(row.exhaustionReason)) return false;
  return (row.tokenBaseline === undefined || validTokenSnapshot(row.tokenBaseline)) &&
    (row.tokenLatest === undefined || validTokenSnapshot(row.tokenLatest));
}

export function parseTaskBudget(value: unknown): TaskBudget | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("budget must be an object"), { status: 400 });
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (!keys.length) throw Object.assign(new Error("budget must contain at least one limit"), { status: 400 });
  if (keys.some((key) => !(TASK_BUDGET_KEYS as readonly string[]).includes(key))) throw Object.assign(new Error("budget contains an unknown limit"), { status: 400 });
  const budget: TaskBudget = {};
  for (const key of keys as TaskBudgetKey[]) {
    const amount = input[key];
    const [minimum, maximum] = BOUNDS[key];
    if (!Number.isSafeInteger(amount) || Number(amount) < minimum || Number(amount) > maximum) {
      throw Object.assign(new Error(`${key} must be an integer between ${minimum} and ${maximum}`), { status: 400 });
    }
    budget[key] = Number(amount);
  }
  return budget;
}

export function isComputerAction(title: string): boolean {
  if (!/^mcp__computer__/i.test(title)) return false;
  return !/(?:screenshot|screen_capture|observe|read_screen|get_(?:screen|state))/i.test(title);
}

export function isDelegation(title: string): boolean {
  return /^mcp__agents__ask_bot$/i.test(title);
}
