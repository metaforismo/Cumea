import { describe, expect, it } from "vitest";
import { isComputerAction, isDelegation, parseTaskBudget, validTaskBudgetUsage } from "./task-budget.ts";

describe("task budgets", () => {
  it("accepts only exact bounded integers", () => {
    expect(parseTaskBudget({ durationMs: 1_000, toolCalls: 2, tokens: 10 })).toEqual({ durationMs: 1_000, toolCalls: 2, tokens: 10 });
    for (const value of [{ toolCalls: "2" }, { toolCalls: true }, { toolCalls: 1.2 }, { toolCalls: NaN }, { unknown: 1 }, {}, []]) {
      expect(() => parseTaskBudget(value)).toThrow();
    }
  });

  it("does not count read-only screen observations as computer actions", () => {
    expect(isComputerAction("mcp__computer__screenshot")).toBe(false);
    expect(isComputerAction("mcp__computer__read_screen")).toBe(false);
    expect(isComputerAction("mcp__computer__click")).toBe(true);
    expect(isDelegation("mcp__agents__ask_bot")).toBe(true);
  });

  it("strictly validates durable usage telemetry before reopening state", () => {
    const valid = {
      startedAt: 1,
      durationUsedMs: 10,
      toolCalls: 1,
      computerActions: 0,
      delegations: 0,
      tokens: 4,
      tokenBaseline: { providerInstanceId: "codex-local", model: "gpt", input: 5, output: 2 },
      tokenLatest: { providerInstanceId: "codex-local", model: "gpt", input: 8, output: 3 },
      exhaustionReason: "tokens",
      exhaustedAt: 12,
    };
    expect(validTaskBudgetUsage(valid)).toBe(true);
    expect(validTaskBudgetUsage({ ...valid, extra: true })).toBe(false);
    expect(validTaskBudgetUsage({ ...valid, toolCalls: "1" })).toBe(false);
    expect(validTaskBudgetUsage({ ...valid, exhaustedAt: undefined })).toBe(false);
    expect(validTaskBudgetUsage({ ...valid, tokenBaseline: { ...valid.tokenBaseline, extra: 1 } })).toBe(false);
    expect(validTaskBudgetUsage({ ...valid, activeSince: 2 })).toBe(false);
  });
});
