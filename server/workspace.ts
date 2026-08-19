import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";
import type { RunLifecycleAlert, RunLifecycleProjection } from "./lifecycle-watchdog.ts";
import { stageFilesForDeletion, type DeletionFile } from "./delete-files.ts";

export type TaskSource = "message" | "routine" | "handoff";
export type TaskStatus = "queued" | "running" | "needs_attention" | "completed" | "failed" | "cancelled";
export type RunStatus = "running" | "needs_attention" | "completed" | "failed" | "cancelled";
export type StepStatus = "running" | "needs_attention" | "completed" | "failed" | "denied";
export type RunAttentionKind = "provider" | "lifecycle";

export interface SectionRecord {
  id: string;
  name: string;
  createdAt: number;
}

export interface AttachmentRecord {
  id: string;
  botId: string;
  threadId: string;
  name: string;
  mime: string;
  size: number;
  storedPath: string;
  createdAt: number;
}

export interface RunStep {
  id: string;
  itemId?: string;
  kind: "tool" | "approval" | "handoff" | "lifecycle";
  title: string;
  status: StepStatus;
  startedAt: number;
  completedAt?: number;
}

export interface RunArtifact {
  id: string;
  kind: "attachment" | "response" | "screen";
  label: string;
  attachmentId?: string;
  messageId?: string;
  mime?: string;
  createdAt: number;
}

export interface TaskRecord {
  id: string;
  botId: string;
  title: string;
  prompt: string;
  source: TaskSource;
  sourceBotId?: string;
  routineId?: string;
  status: TaskStatus;
  attachmentIds: string[];
  latestRunId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RunRecord {
  id: string;
  taskId: string;
  botId: string;
  routineId?: string;
  turnId?: string;
  status: RunStatus;
  steps: RunStep[];
  artifacts: RunArtifact[];
  startedAt: number;
  completedAt?: number;
  error?: string;
  attentionKind?: RunAttentionKind;
  lifecycle?: Omit<RunLifecycleProjection, "threadId" | "runId">;
  lifecycleAlert?: Omit<RunLifecycleAlert, "threadId" | "runId">;
}

export type RoutineSchedule =
  | { kind: "interval"; everyMinutes: number }
  | { kind: "daily"; time: string; timezone: string }
  | { kind: "weekly"; time: string; timezone: string; weekdays: number[] };

export interface RoutineRecord {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastStatus?: "running" | "completed" | "failed";
  lastError?: string;
}

interface WorkspaceData {
  sections: SectionRecord[];
  attachments: AttachmentRecord[];
  tasks: TaskRecord[];
  runs: RunRecord[];
  routines: RoutineRecord[];
}

export interface RemovedBotWorkspaceData {
  attachments: number;
  tasks: number;
  runs: number;
  routines: number;
}

export interface BotDataRemovalTransaction {
  removed: RemovedBotWorkspaceData;
  /** Restore the durable workspace snapshot when the bot-record commit fails. */
  rollback: () => void;
}

const WORKSPACE_FILE = join(DATA_DIR, "workspace.json");
const MAX_HISTORY = 500;
// Persistent per-bot quotas bound authenticated storage growth across restarts.
// The existing per-file HTTP limit remains 25 MiB.
export const ATTACHMENT_MAX_COUNT_PER_BOT = 100;
export const ATTACHMENT_MAX_BYTES_PER_BOT = 250 * 1024 * 1024;

const emptyData = (): WorkspaceData => ({
  sections: [],
  attachments: [],
  tasks: [],
  runs: [],
  routines: [],
});

function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function zonedParts(at: number, timezone: string): { hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: weekdays[get("weekday")] ?? -1,
  };
}

export function validateSchedule(schedule: RoutineSchedule): RoutineSchedule {
  if (schedule.kind === "interval") {
    const everyMinutes = Math.floor(Number(schedule.everyMinutes));
    if (!Number.isFinite(everyMinutes) || everyMinutes < 5 || everyMinutes > 43_200) {
      throw Object.assign(new Error("interval must be between 5 minutes and 30 days"), { status: 400 });
    }
    return { kind: "interval", everyMinutes };
  }
  if (!validTime(schedule.time)) {
    throw Object.assign(new Error("schedule time must use HH:MM"), { status: 400 });
  }
  try {
    zonedParts(Date.now(), schedule.timezone);
  } catch {
    throw Object.assign(new Error("invalid schedule timezone"), { status: 400 });
  }
  if (schedule.kind === "weekly") {
    const weekdays = [...new Set(schedule.weekdays.map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    if (!weekdays.length) throw Object.assign(new Error("weekly schedules need at least one weekday"), { status: 400 });
    return { kind: "weekly", time: schedule.time, timezone: schedule.timezone, weekdays };
  }
  return { kind: "daily", time: schedule.time, timezone: schedule.timezone };
}

export function nextOccurrence(scheduleInput: RoutineSchedule, after: number): number {
  const schedule = validateSchedule(scheduleInput);
  if (schedule.kind === "interval") return after + schedule.everyMinutes * 60_000;

  const [hour, minute] = schedule.time.split(":").map(Number);
  const firstMinute = Math.floor(after / 60_000) * 60_000 + 60_000;
  const minuteLimit = schedule.kind === "weekly" ? 15 * 24 * 60 : 3 * 24 * 60;
  for (let offset = 0; offset < minuteLimit; offset += 1) {
    const candidate = firstMinute + offset * 60_000;
    const parts = zonedParts(candidate, schedule.timezone);
    if (parts.hour !== hour || parts.minute !== minute) continue;
    if (schedule.kind === "weekly" && !schedule.weekdays.includes(parts.weekday)) continue;
    return candidate;
  }
  throw new Error("could not calculate the next routine occurrence");
}

function taskTitle(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine || "Untitled task";
}

export class WorkspaceStore {
  data: WorkspaceData;

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    try {
      const disk = JSON.parse(readFileSync(WORKSPACE_FILE, "utf8")) as Partial<WorkspaceData>;
      this.data = {
        sections: Array.isArray(disk.sections) ? disk.sections : [],
        attachments: Array.isArray(disk.attachments) ? disk.attachments : [],
        tasks: Array.isArray(disk.tasks) ? disk.tasks : [],
        runs: Array.isArray(disk.runs) ? disk.runs : [],
        routines: Array.isArray(disk.routines) ? disk.routines : [],
      };
    } catch {
      this.data = emptyData();
    }

    const now = Date.now();
    let recovered = false;
    for (const run of this.data.runs) {
      if (run.status !== "running" && run.status !== "needs_attention") continue;
      run.status = "failed";
      run.error = "Cumea restarted before this run finished.";
      run.completedAt = now;
      const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
      if (task) {
        task.status = "failed";
        task.updatedAt = now;
      }
      recovered = true;
    }
    for (const routine of this.data.routines) {
      if (routine.lastStatus === "running") {
        routine.lastStatus = "failed";
        routine.lastError = "Cumea restarted before this run finished.";
        recovered = true;
      }
      if (routine.enabled && (!routine.nextRunAt || routine.nextRunAt < now - 60_000)) {
        routine.nextRunAt = nextOccurrence(routine.schedule, now);
        recovered = true;
      }
    }
    if (recovered) this.save();
  }

  private save() {
    this.data.tasks = this.data.tasks.slice(-MAX_HISTORY);
    const taskIds = new Set(this.data.tasks.map((task) => task.id));
    this.data.runs = this.data.runs.filter((run) => taskIds.has(run.taskId)).slice(-MAX_HISTORY);
    writeFileAtomic(WORKSPACE_FILE, JSON.stringify(this.data, null, 2));
  }

  snapshot() {
    return this.data;
  }

  createSection(name: string): SectionRecord {
    const clean = name.trim();
    if (!clean) throw Object.assign(new Error("section name required"), { status: 400 });
    if (this.data.sections.some((section) => section.name.toLowerCase() === clean.toLowerCase())) {
      throw Object.assign(new Error("a section with that name already exists"), { status: 409 });
    }
    const section = { id: newId(), name: clean.slice(0, 60), createdAt: Date.now() };
    this.data.sections.push(section);
    this.save();
    return section;
  }

  patchSection(id: string, name: string): SectionRecord | null {
    const section = this.data.sections.find((candidate) => candidate.id === id);
    if (!section) return null;
    const clean = name.trim();
    if (!clean) throw Object.assign(new Error("section name required"), { status: 400 });
    if (this.data.sections.some((candidate) => candidate.id !== id && candidate.name.toLowerCase() === clean.toLowerCase())) {
      throw Object.assign(new Error("a section with that name already exists"), { status: 409 });
    }
    section.name = clean.slice(0, 60);
    this.save();
    return section;
  }

  deleteSection(id: string): boolean {
    const before = this.data.sections.length;
    this.data.sections = this.data.sections.filter((section) => section.id !== id);
    if (this.data.sections.length === before) return false;
    this.save();
    return true;
  }

  createAttachment(input: Omit<AttachmentRecord, "id" | "createdAt">): AttachmentRecord {
    this.assertAttachmentCapacity(input.botId, input.size);
    const attachment = { ...input, id: newId(), createdAt: Date.now() };
    this.data.attachments.push(attachment);
    this.save();
    return attachment;
  }

  attachmentUsage(botId: string): { count: number; bytes: number } {
    const attachments = this.data.attachments.filter((attachment) => attachment.botId === botId);
    let bytes = 0;
    for (const attachment of attachments) {
      if (!Number.isSafeInteger(attachment.size) || attachment.size < 0) {
        throw Object.assign(new Error("attachment quota is unavailable"), { status: 500 });
      }
      bytes += attachment.size;
      if (!Number.isSafeInteger(bytes)) {
        throw Object.assign(new Error("attachment quota is unavailable"), { status: 500 });
      }
    }
    return { count: attachments.length, bytes };
  }

  assertAttachmentCapacity(botId: string, nextBytes: number): void {
    if (!Number.isSafeInteger(nextBytes) || nextBytes < 0) {
      throw Object.assign(new Error("invalid attachment size"), { status: 400 });
    }
    const usage = this.attachmentUsage(botId);
    if (usage.count >= ATTACHMENT_MAX_COUNT_PER_BOT) {
      throw Object.assign(new Error("attachment count quota reached (100 per bot)"), { status: 429 });
    }
    if (usage.bytes + nextBytes > ATTACHMENT_MAX_BYTES_PER_BOT) {
      throw Object.assign(new Error("attachment storage quota exceeded (250 MB per bot)"), { status: 413 });
    }
  }

  attachment(id: string): AttachmentRecord | null {
    return this.data.attachments.find((candidate) => candidate.id === id) ?? null;
  }

  attachmentsFor(botId: string, ids: string[]): AttachmentRecord[] {
    const unique = [...new Set(ids)];
    const attachments = unique.map((id) => this.attachment(id));
    if (attachments.some((attachment) => !attachment || attachment.botId !== botId)) {
      throw Object.assign(new Error("one or more attachments are unavailable for this bot"), { status: 400 });
    }
    return attachments as AttachmentRecord[];
  }

  deleteAttachment(id: string): boolean {
    const attachment = this.attachment(id);
    if (!attachment) return false;
    if (this.data.tasks.some((task) => task.attachmentIds.includes(id))) {
      throw Object.assign(new Error("attachment belongs to a task and is part of its audit trail"), { status: 409 });
    }
    try {
      unlinkSync(attachment.storedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw Object.assign(new Error("could not remove attachment file"), { status: 500, cause: error });
      }
    }
    // Only forget the record after the file is absent. A failed unlink keeps
    // the workspace reference intact so a retry can finish the rollback.
    this.data.attachments = this.data.attachments.filter((candidate) => candidate.id !== id);
    this.save();
    return true;
  }

  /** Remove every durable workspace record owned by a deleted bot.
   *
   * Routines must not survive their executor: leaving one enabled would keep
   * the scheduler waking up for a bot that can never run it. Tasks and runs
   * are deleted with the same ownership boundary so the workspace cannot
   * retain dangling bot/routine references after the conversation is gone.
   */
  removeBotData(botId: string): RemovedBotWorkspaceData {
    const files = stageFilesForDeletion(this.botDeletionFiles(botId));
    let transaction: BotDataRemovalTransaction | null = null;
    try {
      transaction = this.removeBotDataTransaction(botId);
      files.purge();
      return transaction.removed;
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      try {
        transaction?.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      try {
        files.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      if (rollbackErrors.length) {
        throw Object.assign(new Error("bot workspace deletion failed and could not be fully rolled back"), {
          status: 500,
          cause: new AggregateError([error, ...rollbackErrors]),
        });
      }
      throw error;
    }
  }

  botDeletionFiles(botId: string): DeletionFile[] {
    return this.data.attachments
      .filter((attachment) => attachment.botId === botId)
      .map((attachment) => ({ path: attachment.storedPath, label: `attachment ${attachment.name}` }));
  }

  /**
   * Commit bot-owned workspace cleanup while retaining a one-shot rollback
   * for the outer, cross-store delete transaction.
   */
  removeBotDataTransaction(botId: string): BotDataRemovalTransaction {
    const removedAttachments = this.data.attachments.filter((attachment) => attachment.botId === botId);
    const removedRoutineIds = new Set(
      this.data.routines.filter((routine) => routine.botId === botId).map((routine) => routine.id),
    );
    const removedTaskIds = new Set(
      this.data.tasks
        .filter((task) => task.botId === botId || (task.routineId && removedRoutineIds.has(task.routineId)))
        .map((task) => task.id),
    );
    const removedRuns = this.data.runs.filter(
      (run) =>
        run.botId === botId
        || removedTaskIds.has(run.taskId)
        || Boolean(run.routineId && removedRoutineIds.has(run.routineId)),
    );

    const previous = {
      attachments: this.data.attachments,
      routines: this.data.routines,
      tasks: this.data.tasks,
      runs: this.data.runs,
    };
    this.data.attachments = previous.attachments.filter((attachment) => attachment.botId !== botId);
    this.data.routines = previous.routines.filter((routine) => !removedRoutineIds.has(routine.id));
    this.data.tasks = previous.tasks.filter((task) => !removedTaskIds.has(task.id));
    const removedRunIds = new Set(removedRuns.map((run) => run.id));
    this.data.runs = previous.runs.filter((run) => !removedRunIds.has(run.id));

    const removed = {
      attachments: removedAttachments.length,
      tasks: removedTaskIds.size,
      runs: removedRuns.length,
      routines: removedRoutineIds.size,
    };
    const changed = Object.values(removed).some((count) => count > 0);
    if (changed) {
      try {
        this.save();
      } catch (error) {
        // Atomic file persistence keeps the previous disk snapshot intact;
        // restore memory too. Missing attachment bytes are tolerated on retry.
        Object.assign(this.data, previous);
        throw error;
      }
    }

    let rolledBack = false;
    return {
      removed,
      rollback: () => {
        if (rolledBack || !changed) return;
        Object.assign(this.data, previous);
        try {
          this.save();
          rolledBack = true;
        } catch (error) {
          // Keep the retry records visible in the live store even when the
          // durable rollback itself is blocked.
          throw Object.assign(new Error("could not restore bot workspace records after deletion failed"), {
            status: 500,
            cause: error,
          });
        }
      },
    };
  }

  createTask(input: {
    botId: string;
    prompt: string;
    title?: string;
    source?: TaskSource;
    sourceBotId?: string;
    routineId?: string;
    attachmentIds?: string[];
  }): TaskRecord {
    const now = Date.now();
    const task: TaskRecord = {
      id: newId(),
      botId: input.botId,
      title: (input.title?.trim() || taskTitle(input.prompt)).slice(0, 100),
      prompt: input.prompt,
      source: input.source ?? "message",
      ...(input.sourceBotId ? { sourceBotId: input.sourceBotId } : {}),
      ...(input.routineId ? { routineId: input.routineId } : {}),
      status: "queued",
      attachmentIds: input.attachmentIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.data.tasks.push(task);
    this.save();
    return task;
  }

  task(id: string): TaskRecord | null {
    return this.data.tasks.find((candidate) => candidate.id === id) ?? null;
  }

  createRun(taskId: string): RunRecord {
    const task = this.data.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("no such task");
    const run: RunRecord = {
      id: newId(),
      taskId,
      botId: task.botId,
      ...(task.routineId ? { routineId: task.routineId } : {}),
      status: "running",
      steps: [],
      artifacts: task.attachmentIds.map((attachmentId) => {
        const attachment = this.attachment(attachmentId);
        return {
          id: newId(),
          kind: "attachment" as const,
          label: attachment?.name ?? "Attachment",
          attachmentId,
          mime: attachment?.mime,
          createdAt: Date.now(),
        };
      }),
      startedAt: Date.now(),
    };
    task.status = "running";
    task.updatedAt = Date.now();
    task.latestRunId = run.id;
    this.data.runs.push(run);
    if (task.routineId) {
      const routine = this.data.routines.find((candidate) => candidate.id === task.routineId);
      if (routine) {
        routine.lastRunAt = run.startedAt;
        routine.lastStatus = "running";
        routine.lastError = undefined;
      }
    }
    this.save();
    return run;
  }

  run(id: string): RunRecord | null {
    return this.data.runs.find((candidate) => candidate.id === id) ?? null;
  }

  bindTurn(runId: string, turnId: string) {
    const run = this.run(runId);
    if (!run) return;
    run.turnId = turnId;
    this.save();
  }


  setRunLifecycle(runId: string, projection: RunLifecycleProjection): boolean {
    const run = this.run(runId);
    if (!run || run.completedAt !== undefined || projection.runId !== runId) return false;
    const next = {
      state: projection.state,
      lastActivityAt: projection.lastActivityAt,
      ...(projection.waitingSince !== undefined ? { waitingSince: projection.waitingSince } : {}),
      ...(projection.reason ? { reason: projection.reason } : {}),
      ...(projection.repeatCount !== undefined ? { repeatCount: projection.repeatCount } : {}),
    };
    const previous = run.lifecycle;
    const lifecycleChanged = JSON.stringify(previous ?? null) !== JSON.stringify(next);
    if (lifecycleChanged) run.lifecycle = next;

    let attentionChanged = false;
    if (
      run.attentionKind === "lifecycle" &&
      run.lifecycleAlert?.kind !== "repeated_effect" &&
      (projection.state === "working" || projection.state === "waiting")
    ) {
      const step = [...run.steps].reverse().find((candidate) => candidate.kind === "lifecycle" && candidate.status === "needs_attention");
      if (step) {
        step.status = "completed";
        step.completedAt = Date.now();
      }
      run.attentionKind = undefined;
      run.lifecycleAlert = undefined;
      if (run.status === "needs_attention") run.status = "running";
      const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
      if (task?.status === "needs_attention") {
        task.status = "running";
        task.updatedAt = Date.now();
      }
      attentionChanged = true;
    }
    if (lifecycleChanged || attentionChanged) this.save();
    return lifecycleChanged || attentionChanged;
  }

  markLifecycleAttention(runId: string, alert: RunLifecycleAlert): boolean {
    const run = this.run(runId);
    if (!run || run.completedAt !== undefined || alert.runId !== runId) return false;
    // A real provider ask owns attention while it is unresolved. The watchdog
    // is advisory and must never replace an approval/question boundary.
    if (run.attentionKind === "provider") return false;
    if (
      run.attentionKind === "lifecycle" &&
      run.lifecycleAlert?.kind === alert.kind &&
      run.lifecycleAlert.title === alert.title
    ) return false;

    if (run.attentionKind === "lifecycle") {
      const prior = [...run.steps].reverse().find((candidate) => candidate.kind === "lifecycle" && candidate.status === "needs_attention");
      if (prior) {
        prior.status = "completed";
        prior.completedAt = Date.now();
      }
    }
    run.attentionKind = "lifecycle";
    run.lifecycleAlert = {
      kind: alert.kind,
      title: alert.title,
      observedAt: alert.observedAt,
      ...(alert.signature ? { signature: alert.signature } : {}),
      ...(alert.repeatCount !== undefined ? { repeatCount: alert.repeatCount } : {}),
    };
    run.status = "needs_attention";
    const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
    if (task) {
      task.status = "needs_attention";
      task.updatedAt = Date.now();
    }
    run.steps.push({
      id: newId(),
      itemId: `lifecycle:${alert.kind}:${alert.observedAt}`,
      kind: "lifecycle",
      title: alert.title,
      status: "needs_attention",
      startedAt: alert.observedAt,
    });
    this.save();
    return true;
  }

  addStep(runId: string, input: Pick<RunStep, "kind" | "title"> & { itemId?: string; status?: StepStatus }): RunStep | null {
    const run = this.run(runId);
    if (!run) return null;
    const step: RunStep = {
      id: newId(),
      ...(input.itemId ? { itemId: input.itemId } : {}),
      kind: input.kind,
      title: input.title,
      status: input.status ?? "running",
      startedAt: Date.now(),
    };
    run.steps.push(step);
    this.save();
    return step;
  }

  completeStep(runId: string, itemId: string | undefined, status: StepStatus): RunStep | null {
    const run = this.run(runId);
    if (!run) return null;
    const step = [...run.steps].reverse().find((candidate) =>
      itemId ? candidate.itemId === itemId : candidate.status === "running" || candidate.status === "needs_attention",
    );
    if (!step) return null;
    step.status = status;
    step.completedAt = Date.now();
    this.save();
    return step;
  }

  addArtifact(runId: string, input: Omit<RunArtifact, "id" | "createdAt">): RunArtifact | null {
    const run = this.run(runId);
    if (!run) return null;
    const artifact = { ...input, id: newId(), createdAt: Date.now() };
    run.artifacts.push(artifact);
    this.save();
    return artifact;
  }

  markNeedsAttention(runId: string, title: string, itemId?: string) {
    const run = this.run(runId);
    if (!run) return;
    if (run.attentionKind === "lifecycle") {
      const lifecycleStep = [...run.steps].reverse().find((candidate) => candidate.kind === "lifecycle" && candidate.status === "needs_attention");
      if (lifecycleStep) { lifecycleStep.status = "completed"; lifecycleStep.completedAt = Date.now(); }
      run.lifecycleAlert = undefined;
    }
    run.attentionKind = "provider";
    run.status = "needs_attention";
    const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
    if (task) {
      task.status = "needs_attention";
      task.updatedAt = Date.now();
    }
    this.addStep(runId, { kind: "approval", title, itemId, status: "needs_attention" });
  }

  resumeRun(runId: string, requestId?: string, denied = false) {
    const run = this.run(runId);
    if (!run) return;
    this.completeStep(runId, requestId, denied ? "denied" : "completed");
    if (!denied) {
      run.attentionKind = undefined;
      run.status = "running";
      const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
      if (task) {
        task.status = "running";
        task.updatedAt = Date.now();
      }
    }
    this.save();
  }

  completeRun(runId: string, ok: boolean, error?: string) {
    const run = this.run(runId);
    if (!run) return;
    const now = Date.now();
    run.status = ok ? "completed" : error === "interrupted" ? "cancelled" : "failed";
    run.completedAt = now;
    run.attentionKind = undefined;
    run.lifecycleAlert = undefined;
    run.lifecycle = undefined;
    if (!ok && error) run.error = error;
    for (const step of run.steps) {
      if (step.status === "running" || step.status === "needs_attention") {
        step.status = ok ? "completed" : "failed";
        step.completedAt = now;
      }
    }
    const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
    if (task) {
      task.status = run.status;
      task.updatedAt = now;
    }
    if (run.routineId) {
      const routine = this.data.routines.find((candidate) => candidate.id === run.routineId);
      if (routine) {
        routine.lastStatus = ok ? "completed" : "failed";
        routine.lastError = ok ? undefined : error || "Run failed";
      }
    }
    this.save();
  }

  createRoutine(input: {
    botId: string;
    name: string;
    prompt: string;
    schedule: RoutineSchedule;
    enabled?: boolean;
  }): RoutineRecord {
    const name = input.name.trim();
    const prompt = input.prompt.trim();
    if (!name || !prompt) throw Object.assign(new Error("routine name and task are required"), { status: 400 });
    const schedule = validateSchedule(input.schedule);
    const now = Date.now();
    const enabled = input.enabled ?? true;
    const routine: RoutineRecord = {
      id: newId(),
      botId: input.botId,
      name: name.slice(0, 100),
      prompt,
      schedule,
      enabled,
      nextRunAt: enabled ? nextOccurrence(schedule, now) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.data.routines.push(routine);
    this.save();
    return routine;
  }

  patchRoutine(id: string, patch: Partial<Pick<RoutineRecord, "name" | "prompt" | "schedule" | "enabled">>): RoutineRecord | null {
    const routine = this.data.routines.find((candidate) => candidate.id === id);
    if (!routine) return null;
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw Object.assign(new Error("routine name required"), { status: 400 });
      routine.name = name.slice(0, 100);
    }
    if (patch.prompt !== undefined) {
      const prompt = patch.prompt.trim();
      if (!prompt) throw Object.assign(new Error("routine task required"), { status: 400 });
      routine.prompt = prompt;
    }
    if (patch.schedule !== undefined) routine.schedule = validateSchedule(patch.schedule);
    if (patch.enabled !== undefined) routine.enabled = patch.enabled;
    routine.nextRunAt = routine.enabled ? nextOccurrence(routine.schedule, Date.now()) : null;
    routine.updatedAt = Date.now();
    this.save();
    return routine;
  }

  deleteRoutine(id: string): boolean {
    const before = this.data.routines.length;
    this.data.routines = this.data.routines.filter((routine) => routine.id !== id);
    if (before === this.data.routines.length) return false;
    this.save();
    return true;
  }

  dueRoutines(at = Date.now()): RoutineRecord[] {
    return this.data.routines.filter((routine) => routine.enabled && routine.nextRunAt !== null && routine.nextRunAt <= at);
  }

  advanceRoutine(id: string, from = Date.now()): RoutineRecord | null {
    const routine = this.data.routines.find((candidate) => candidate.id === id);
    if (!routine) return null;
    routine.nextRunAt = routine.enabled ? nextOccurrence(routine.schedule, from) : null;
    routine.updatedAt = Date.now();
    this.save();
    return routine;
  }

  markRoutineFailure(id: string, message: string): RoutineRecord | null {
    const routine = this.data.routines.find((candidate) => candidate.id === id);
    if (!routine) return null;
    routine.lastRunAt = Date.now();
    routine.lastStatus = "failed";
    routine.lastError = message;
    routine.updatedAt = Date.now();
    this.save();
    return routine;
  }
}
