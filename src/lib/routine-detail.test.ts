import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RoutineRecord, RunRecord, TaskRecord } from "@/state/store";
import { RoutinePrivacyBoundary } from "@/components/WorkPanel";
import { createRoutineDraft, routineDraftAfterSaveAttempt, routineHistory, routinePatchFromDraft } from "./routine-detail";

const routine: RoutineRecord = {
  id: "routine-1",
  botId: "bot-1",
  name: "Morning brief",
  prompt: "stored private task with SECRET_DO_NOT_RENDER",
  schedule: { kind: "daily", time: "02:30", timezone: "America/New_York" },
  enabled: true,
  nextRunAt: null,
  createdAt: 1,
  updatedAt: 2,
};

function task(id: string, status: TaskRecord["status"], routineId = "routine-1"): TaskRecord {
  return { id, botId: "bot-1", title: id, prompt: "private", source: "routine", routineId, status, attachmentIds: [], createdAt: 1, updatedAt: 2 };
}

function run(id: string, taskId: string, status: RunRecord["status"], routineId = "routine-1"): RunRecord {
  return { id, taskId, botId: "bot-1", routineId, status, steps: [], artifacts: [], startedAt: 3 };
}

describe("routine detail contracts", () => {
  it("builds a strict PATCH while retaining the canonical timezone across DST", () => {
    const draft = createRoutineDraft(routine, "Europe/Rome");
    expect(draft.replacementPrompt).toBe("");
    expect(routinePatchFromDraft(draft)).toEqual({
      name: "Morning brief",
      schedule: { kind: "daily", time: "02:30", timezone: "America/New_York" },
      enabled: true,
    });
    expect(routinePatchFromDraft({ ...draft, replacementPrompt: "New task" })).toEqual({
      name: "Morning brief",
      prompt: "New task",
      schedule: { kind: "daily", time: "02:30", timezone: "America/New_York" },
      enabled: true,
    });
  });

  it("filters canonical task/run history by routineId and maps its user-facing states", () => {
    const items = routineHistory(
      [task("success", "completed"), task("attention", "needs_attention"), task("failed", "running"), task("other", "completed", "routine-2")],
      [run("run-success", "success", "completed"), run("run-attention", "attention", "interrupted"), run("run-failed", "failed", "failed"), run("run-other", "other", "completed", "routine-2")],
      "routine-1",
    );
    expect(items.map((item) => [item.task?.id, item.status])).toEqual([
      ["success", "success"],
      ["attention", "needs-you"],
      ["failed", "failure"],
    ]);
  });

  it("keeps every canonical attempt, orders by timestamp, and never guesses across routines", () => {
    const needsYouTask = task("retry-task", "needs_attention");
    const first = { ...run("attempt-1", "retry-task", "failed"), attempt: 1, startedAt: 10, completedAt: 20 };
    const second = { ...run("attempt-2", "retry-task", "running"), attempt: 2, startedAt: 30 };
    const otherRoutine = { ...run("attempt-other", "retry-task", "completed", "routine-2"), startedAt: 40 };
    const taskOnly = { ...task("task-only", "completed"), updatedAt: 25 };
    const items = routineHistory([needsYouTask, taskOnly], [first, second, otherRoutine], "routine-1");
    expect(items.map((item) => [item.run?.id ?? "task-only", item.status])).toEqual([
      ["attempt-2", "needs-you"],
      ["task-only", "success"],
      ["attempt-1", "failure"],
    ]);
  });

  it("round-trips every weekly weekday and timezone during a rename", () => {
    const weekly: RoutineRecord = {
      ...routine,
      name: "Multi-day",
      schedule: { kind: "weekly", time: "09:00", timezone: "Europe/Rome", weekdays: [1, 3, 5] },
    };
    const draft = { ...createRoutineDraft(weekly, "America/Los_Angeles"), name: "Renamed" };
    expect(routinePatchFromDraft(draft)).toEqual({
      name: "Renamed",
      schedule: { kind: "weekly", time: "09:00", timezone: "Europe/Rome", weekdays: [1, 3, 5] },
      enabled: true,
    });
    expect(() => routinePatchFromDraft({ ...draft, weekdays: [] })).toThrow(/at least one weekday/i);
  });

  it("keeps the complete draft after a failed save attempt", () => {
    const draft = { ...createRoutineDraft(routine, "Europe/Rome"), name: "Edited name", replacementPrompt: "Edited private task", time: "03:45" };
    expect(routineDraftAfterSaveAttempt(draft, false)).toBe(draft);
    expect(routineDraftAfterSaveAttempt(draft, true)).toEqual({ ...draft, replacementPrompt: "" });
  });

  it("SSR keeps the stored prompt out of the routine detail surface", () => {
    const markup = renderToStaticMarkup(createElement(RoutinePrivacyBoundary));
    expect(markup).toContain("write-only");
    expect(markup).not.toContain(routine.prompt);
  });
});
