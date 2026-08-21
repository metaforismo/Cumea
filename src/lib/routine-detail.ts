import type { RoutineRecord, RoutineSchedule, RunRecord, TaskRecord } from "@/state/store";

export type RoutineDraft = {
  name: string;
  replacementPrompt: string;
  kind: RoutineSchedule["kind"];
  time: string;
  everyMinutes: number;
  weekdays: number[];
  enabled: boolean;
  timezone: string;
};

export type RoutineHistoryStatus = "needs-you" | "failure" | "success" | "active";

export type RoutineHistoryItem = {
  task?: TaskRecord;
  run?: RunRecord;
  status: RoutineHistoryStatus;
  at: number;
};

export function createRoutineDraft(routine: RoutineRecord, browserTimezone: string): RoutineDraft {
  const schedule = routine.schedule;
  return {
    name: routine.name,
    replacementPrompt: "",
    kind: schedule.kind,
    time: schedule.kind === "interval" ? "09:00" : schedule.time,
    everyMinutes: schedule.kind === "interval" ? schedule.everyMinutes : 60,
    weekdays: schedule.kind === "weekly" ? [...schedule.weekdays] : [1],
    enabled: routine.enabled,
    // Existing wall-clock schedules retain their canonical IANA zone. Changing
    // machines must not silently move a routine across a DST boundary.
    timezone: schedule.kind === "interval" ? browserTimezone : schedule.timezone,
  };
}

export function routinePatchFromDraft(draft: RoutineDraft): {
  name: string;
  prompt?: string;
  schedule: RoutineSchedule;
  enabled: boolean;
} {
  const name = draft.name.trim();
  if (!name) throw new Error("Routine name is required.");

  const weekdays = [...new Set(draft.weekdays)].sort((left, right) => left - right);
  if (draft.kind === "weekly" && !weekdays.length) throw new Error("Choose at least one weekday.");
  const schedule: RoutineSchedule = draft.kind === "interval"
    ? { kind: "interval", everyMinutes: draft.everyMinutes }
    : draft.kind === "weekly"
      ? { kind: "weekly", time: draft.time, timezone: draft.timezone, weekdays }
      : { kind: "daily", time: draft.time, timezone: draft.timezone };
  const replacementPrompt = draft.replacementPrompt.trim();
  return {
    name,
    ...(replacementPrompt ? { prompt: replacementPrompt } : {}),
    schedule,
    enabled: draft.enabled,
  };
}

export function routineDraftAfterSaveAttempt(draft: RoutineDraft, succeeded: boolean): RoutineDraft {
  return succeeded ? { ...draft, replacementPrompt: "" } : draft;
}

export function routineHistoryStatus(task?: TaskRecord, run?: RunRecord): RoutineHistoryStatus {
  // The task is the user-facing coordination state. During a workspace-frame
  // race it can already require attention while its run still says running.
  if ((task?.status === "needs_attention" || task?.status === "interrupted") && (!run || run.status === "running")) return "needs-you";
  const status = run?.status ?? task?.status;
  if (status === "needs_attention" || status === "interrupted") return "needs-you";
  if (status === "failed" || status === "cancelled") return "failure";
  if (status === "completed") return "success";
  return "active";
}

export function routineHistory(
  tasks: TaskRecord[],
  runs: RunRecord[],
  routineId: string,
): RoutineHistoryItem[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const canonicalRuns = runs.filter((run) => run.routineId === routineId);
  const taskIdsWithCanonicalRuns = new Set(canonicalRuns.map((run) => run.taskId));
  return [
    ...canonicalRuns.map((run) => {
      const task = taskById.get(run.taskId);
      return { task, run, status: routineHistoryStatus(task, run), at: run.completedAt ?? run.startedAt };
    }),
    ...tasks
      .filter((task) => task.routineId === routineId && !taskIdsWithCanonicalRuns.has(task.id))
      .map((task) => ({ task, status: routineHistoryStatus(task), at: task.updatedAt })),
  ]
    .sort((left, right) => right.at - left.at);
}
