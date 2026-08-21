import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import {
  ATTACHMENT_MAX_BYTES_PER_BOT,
  ATTACHMENT_MAX_COUNT_PER_BOT,
  nextOccurrence,
  WorkspaceStore,
} from "./workspace.ts";

describe("WorkspaceStore", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("persists sections, tasks, runs, steps, and artifacts", () => {
    const store = new WorkspaceStore();
    const section = store.createSection("Operations");
    const task = store.createTask({ botId: "bot-1", prompt: "Prepare the weekly report" });
    const run = store.createRun(task.id);
    store.bindTurn(run.id, "turn-1");
    store.addStep(run.id, { kind: "tool", title: "Read inbox", itemId: "tool-1" });
    store.completeStep(run.id, "tool-1", "completed");
    store.addArtifact(run.id, { kind: "response", label: "Final response", messageId: "message-1" });
    store.completeRun(run.id, true);

    const reloaded = new WorkspaceStore();
    expect(reloaded.snapshot().sections).toContainEqual(section);
    expect(reloaded.snapshot().tasks[0]).toMatchObject({ status: "completed", latestRunId: run.id });
    expect(reloaded.snapshot().runs[0]).toMatchObject({
      turnId: "turn-1",
      status: "completed",
      steps: [{ title: "Read inbox", status: "completed" }],
      artifacts: [{ label: "Final response", messageId: "message-1" }],
    });
  });

  it("tracks attention and denial without pretending the run completed", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-1", prompt: "Send the note" });
    const run = store.createRun(task.id);
    store.markNeedsAttention(run.id, "Allow send?", "request-1");

    expect(store.snapshot().tasks[0].status).toBe("needs_attention");
    expect(store.run(run.id)?.status).toBe("needs_attention");

    store.resumeRun(run.id, "request-1", true);
    expect(store.run(run.id)?.steps[0].status).toBe("denied");
    expect(store.run(run.id)?.status).toBe("needs_attention");
  });

  it("recovers an accepted running turn as an explicitly resumable interrupted run", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-resume", prompt: "Continue the report" });
    store.bindTaskMessage(task.id, "message-resume");
    const run = store.createRun(task.id);
    store.initializeCheckpoint(run.id, {
      activeLeafId: "message-resume", instanceId: "claude-1", model: "sonnet", cursor: { session: "private" },
    });
    store.updateCheckpoint(run.id, {
      phase: "turn_accepted", activeLeafId: "message-resume", instanceId: "claude-1", model: "sonnet", cursor: { session: "private" },
    });

    const recovered = new WorkspaceStore();
    expect(recovered.task(task.id)).toMatchObject({ status: "interrupted", latestRunId: run.id, messageId: "message-resume" });
    expect(recovered.run(run.id)).toMatchObject({ status: "interrupted", resumeStatus: "available" });
    expect(recovered.run(run.id)?.checkpoint).toMatchObject({ status: "available", phase: "turn_accepted" });
  });

  it("never offers restart before provider acceptance or with an unknown effect", () => {
    const store = new WorkspaceStore();
    const earlyTask = store.createTask({ botId: "bot-early", prompt: "Early" });
    const earlyRun = store.createRun(earlyTask.id);
    store.initializeCheckpoint(earlyRun.id, { activeLeafId: "message-early", instanceId: "codex-1", model: "gpt", cursor: null });
    const effectTask = store.createTask({ botId: "bot-effect", prompt: "Effect" });
    const effectRun = store.createRun(effectTask.id);
    store.initializeCheckpoint(effectRun.id, { activeLeafId: "message-effect", instanceId: "codex-1", model: "gpt", cursor: null });
    store.updateCheckpoint(effectRun.id, { phase: "tool", activeLeafId: "message-effect", instanceId: "codex-1", model: "gpt", cursor: null });
    store.observeOpaqueExternalEffect(effectRun.id, { descriptor: { boundary: "provider", action: "write" }, itemId: "tool-write" });

    const recovered = new WorkspaceStore();
    expect(recovered.run(earlyRun.id)).toMatchObject({ status: "interrupted", resumeStatus: "unsafe", resumeUnsafeReason: "turn_not_accepted" });
    expect(recovered.run(effectRun.id)).toMatchObject({ status: "interrupted", resumeStatus: "unsafe", resumeUnsafeReason: "unknown_effect" });
    expect(() => recovered.createResumeRun(effectRun.id)).toThrow(/not safe/);
  });

  it("creates exactly one linked attempt and consumes the checkpoint without duplicating artifacts", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-linked", prompt: "Resume", attachmentIds: [] });
    store.bindTaskMessage(task.id, "message-linked");
    const run = store.createRun(task.id);
    store.initializeCheckpoint(run.id, { activeLeafId: "message-linked", instanceId: "claude-1", model: "sonnet", cursor: null });
    store.updateCheckpoint(run.id, { phase: "provider", activeLeafId: "message-linked", instanceId: "claude-1", model: "sonnet", cursor: null });
    const recovered = new WorkspaceStore();

    const next = recovered.createResumeRun(run.id);
    expect(recovered.snapshot().runs.filter((candidate) => candidate.taskId === task.id)).toHaveLength(2);
    expect(next).toMatchObject({ resumeOfRunId: run.id, resumedFromCheckpointId: run.checkpoint?.id, attempt: 2, artifacts: [] });
    expect(recovered.run(run.id)).toMatchObject({ resumeStatus: "resumed", checkpoint: { status: "consumed", resumedByRunId: next.id } });
    expect(recovered.task(task.id)).toMatchObject({ status: "running", latestRunId: next.id, messageId: "message-linked" });
  });

  it("keeps task completion separate from objective evidence and persists canonical observations", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-evidence", prompt: "Prepare a release" });
    const requirement = store.addEvidenceRequirement(task.id, "The release artifact is attached");
    const run = store.createRun(task.id);
    const step = store.addStep(run.id, { kind: "tool", title: "Build succeeded", itemId: "tool-build" })!;
    store.completeStep(run.id, "tool-build", "completed");
    store.completeRun(run.id, true);

    expect(store.task(task.id)?.status).toBe("completed");
    expect(store.verificationStatus(task.id)).toBe("pending");
    const claim = store.recordEvidenceClaim({ taskId: task.id, requirementId: requirement.id, runId: run.id, label: "The provider says the build is ready" });
    expect(claim).toMatchObject({ level: "claimed", source: "system" });
    expect(store.verificationStatus(task.id)).toBe("claimed");

    const evidence = store.recordEvidence({
      taskId: task.id,
      requirementId: requirement.id,
      runId: run.id,
      reference: { kind: "step", id: step.id },
    });
    expect(evidence).toMatchObject({
      level: "observed",
      source: "user",
      label: "Build succeeded",
      reference: { kind: "step", id: step.id, runId: run.id },
    });
    expect(evidence.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(store.verificationStatus(task.id)).toBe("observed");
    expect(store.recordEvidence({
      taskId: task.id,
      requirementId: requirement.id,
      runId: run.id,
      reference: { kind: "step", id: step.id },
    }).id).toBe(evidence.id);
    expect(store.run(run.id)?.evidence).toHaveLength(2);

    const reloaded = new WorkspaceStore();
    expect(reloaded.verificationStatus(task.id)).toBe("observed");
    expect(reloaded.run(run.id)?.evidence).toEqual([claim, evidence]);
  });

  it("only a trusted verifier entry point can mark every requirement verified", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-evidence", prompt: "Verify output" });
    const requirement = store.addEvidenceRequirement(task.id, "Output matches the fixture");
    const run = store.createRun(task.id);
    const artifact = store.addArtifact(run.id, { kind: "response", label: "Result", messageId: "message-1" })!;

    const record = store.recordVerifiedEvidence({
      taskId: task.id,
      requirementId: requirement.id,
      runId: run.id,
      reference: { kind: "artifact", id: artifact.id },
      verifier: { id: "fixture-comparator", version: "1.2.0" },
    });
    expect(record).toMatchObject({ level: "verified", source: "verifier", verifier: { id: "fixture-comparator", version: "1.2.0" } });
    expect(store.verificationStatus(task.id)).toBe("verified");
  });

  it("rejects evidence references across task ownership boundaries and bounds policy input", () => {
    const store = new WorkspaceStore();
    const first = store.createTask({ botId: "bot-a", prompt: "First" });
    const second = store.createTask({ botId: "bot-b", prompt: "Second" });
    const requirement = store.addEvidenceRequirement(first.id, "Owned evidence");
    const foreignRun = store.createRun(second.id);
    const foreignStep = store.addStep(foreignRun.id, { kind: "tool", title: "Foreign" })!;

    expect(() => store.recordEvidence({
      taskId: first.id,
      requirementId: requirement.id,
      runId: foreignRun.id,
      reference: { kind: "step", id: foreignStep.id },
    })).toThrow(/does not belong/);
    expect(() => store.addEvidenceRequirement(first.id, "x".repeat(501))).toThrow(/too long/);
    expect(() => store.addEvidenceRequirement(first.id, "Owned evidence")).toThrow(/already exists/);
  });

  it("fails closed when optional verification evidence is corrupt on disk", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-evidence", prompt: "Do not trust corrupt proof" });
    const requirement = store.addEvidenceRequirement(task.id, "Independent proof");
    const run = store.createRun(task.id);
    const workspaceFile = join(DATA_DIR, "workspace.json");
    const disk = JSON.parse(readFileSync(workspaceFile, "utf8"));
    disk.runs[0].evidence = [{
      id: "fake-evidence",
      requirementId: requirement.id,
      level: "verified",
      source: "verifier",
      label: "forged",
      recordedAt: Date.now(),
      // Missing verifier identity and canonical reference/digest.
    }];
    writeFileSync(workspaceFile, JSON.stringify(disk));

    const reloaded = new WorkspaceStore();
    expect(reloaded.run(run.id)?.evidence).toEqual([]);
    expect(reloaded.verificationStatus(task.id)).toBe("pending");
  });

  it("persists FIFO message queues and settles only queued message work", () => {
    const store = new WorkspaceStore();
    const first = store.createTask({ botId: "bot-queue", prompt: "First", source: "message" });
    const second = store.createTask({ botId: "bot-queue", prompt: "Second", source: "message" });
    const routine = store.createTask({ botId: "bot-queue", prompt: "Scheduled", source: "routine" });
    expect(store.bindQueuedMessage(first.id, "message-first")).toMatchObject({ messageId: "message-first" });
    expect(store.bindQueuedMessage(second.id, "message-second")).toMatchObject({ messageId: "message-second" });
    expect(store.queuedMessageTasks("bot-queue").map((task) => task.id)).toEqual([first.id, second.id]);
    expect(store.settleQueuedTask(routine.id, "cancelled")).toBeNull();
    expect(store.settleQueuedTask(first.id, "cancelled")).toMatchObject({ status: "cancelled" });

    const reloaded = new WorkspaceStore();
    expect(reloaded.queuedMessageTasks("bot-queue").map((task) => task.id)).toEqual([second.id]);
    expect(reloaded.task(first.id)).toMatchObject({ status: "cancelled", messageId: "message-first" });
  });

  it("accounts task budgets durably across sequential attempts without inventing token usage", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-budget", prompt: "Bounded", budget: { toolCalls: 3, tokens: 100 } });
    const first = store.createRun(task.id);
    expect(store.chargeBudget(first.id, "toolCalls")).toBeNull();
    expect(store.observeTokenUsage(first.id, "provider-a", "model-a", 1_000, 100)).toBeNull();
    expect(store.run(first.id)?.budgetUsage?.tokens).toBeUndefined();
    expect(store.observeTokenUsage(first.id, "provider-a", "model-a", 1_020, 110)).toBeNull();
    expect(store.run(first.id)?.budgetUsage?.tokens).toBe(30);
    store.completeRun(first.id, false, "failed");

    const second = store.createRun(task.id);
    expect(second.budgetUsage?.tokenBaseline).toBeUndefined();
    expect(store.observeTokenUsage(second.id, "provider-a", "model-a", 1_025, 115)).toBeNull();
    expect(second.budgetUsage?.tokens).toBe(10);
    expect(store.observeTokenUsage(second.id, "provider-a", "model-a", 2, 1)).toBeNull();
    expect(second.budgetUsage?.tokens).toBe(10);
    expect(store.chargeBudget(second.id, "toolCalls")).toBeNull();
    expect(store.chargeBudget(second.id, "toolCalls")).toBe("toolCalls");
    expect(store.markBudgetExhausted(second.id, "toolCalls")).toBe(true);
    expect(store.task(task.id)).toMatchObject({ status: "needs_attention", budget: { toolCalls: 3, tokens: 100 } });

    const reloaded = new WorkspaceStore();
    expect(reloaded.budgetTotals(task.id)).toMatchObject({ toolCalls: 3, tokens: 40 });
    expect(reloaded.run(second.id)?.budgetUsage).toMatchObject({ exhaustionReason: "toolCalls" });

    const switchedTask = store.createTask({ botId: "bot-budget", prompt: "Other provider", budget: { tokens: 100 } });
    const switched = store.createRun(switchedTask.id);
    expect(store.observeTokenUsage(switched.id, undefined, undefined, 50_000, 5_000)).toBeNull();
    expect(store.observeTokenUsage(switched.id, "provider-b", "model-b", 50_000, 5_000)).toBeNull();
    expect(switched.budgetUsage?.tokens).toBeUndefined();
    expect(store.observeTokenUsage(switched.id, "provider-b", "model-b", 50_010, 5_005)).toBeNull();
    expect(switched.budgetUsage?.tokens).toBe(15);
    expect(store.observeTokenUsage(switched.id, "provider-b", "model-c", 90_000, 9_000)).toBeNull();
    expect(switched.budgetUsage?.tokens).toBe(15);
  });

  it("starts a durable deadline at run creation and rejects coercive budget input", () => {
    const store = new WorkspaceStore();
    for (const budget of [{ toolCalls: "2" }, { durationMs: true }, { tokens: NaN }, { nope: 1 }]) {
      expect(() => store.createTask({ botId: "bot-budget", prompt: "Invalid", budget })).toThrow();
    }
    const task = store.createTask({ botId: "bot-budget", prompt: "Deadline", budget: { durationMs: 1_000 } });
    const run = store.createRun(task.id);
    expect(store.checkDurationBudget(run.id, run.startedAt + 999)).toBeNull();
    expect(store.checkDurationBudget(run.id, run.startedAt + 1_000)).toBe("durationMs");
  });

  it("does not replenish a task duration budget across attempts", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-duration", prompt: "Across attempts", budget: { durationMs: 1_000 } });
    const first = store.createRun(task.id);
    first.budgetUsage!.activeSince = Date.now() - 700;
    store.completeRun(first.id, false, "retryable");
    expect(store.task(task.id)!.budgetDurationUsedMs).toBeGreaterThanOrEqual(700);
    const second = store.createRun(task.id);
    expect(store.checkDurationBudget(second.id, second.startedAt + 400)).toBe("durationMs");
  });

  it("pauses active duration while a run waits for a human decision", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-pause", prompt: "Wait for approval", budget: { durationMs: 1_000 } });
    const run = store.createRun(task.id);
    run.budgetUsage!.activeSince = 1_000;
    store.pauseBudgetDuration(run.id, 1_400);
    expect(run.budgetUsage).toMatchObject({ durationUsedMs: 400 });
    expect(run.budgetUsage?.activeSince).toBeUndefined();
    expect(store.checkDurationBudget(run.id, 50_000)).toBeNull();
    expect(store.resumeBudgetDuration(run.id, 5_000)).toBe(true);
    expect(store.checkDurationBudget(run.id, 5_599)).toBeNull();
    expect(store.checkDurationBudget(run.id, 5_600)).toBe("durationMs");
  });

  it("accounts every applicable dimension on the event that exhausts a budget", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-multi", prompt: "One combined tool", budget: { toolCalls: 1, computerActions: 1, delegations: 1 } });
    const run = store.createRun(task.id);
    expect(store.chargeBudget(run.id, "toolCalls")).toBe("toolCalls");
    expect(store.chargeBudget(run.id, "computerActions")).toBe("toolCalls");
    expect(store.chargeBudget(run.id, "delegations")).toBe("toolCalls");
    expect(run.budgetUsage).toMatchObject({ toolCalls: 1, computerActions: 1, delegations: 1, exhaustionReason: "toolCalls" });
  });

  it("creates durable routines, pauses them, and calculates future runs", () => {
    const store = new WorkspaceStore();
    const routine = store.createRoutine({
      botId: "bot-1",
      name: "Inbox pass",
      prompt: "Triage the inbox and leave drafts",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect(routine.nextRunAt).toBeGreaterThan(Date.now());

    const reloaded = new WorkspaceStore();
    expect(reloaded.snapshot().routines[0]).toMatchObject({ name: "Inbox pass", enabled: true });
    reloaded.patchRoutine(routine.id, { enabled: false });
    expect(reloaded.snapshot().routines[0].nextRunAt).toBeNull();
  });

  it("claims one latest occurrence after a short offline gap and persists its dedupe key", () => {
    const store = new WorkspaceStore();
    const routine = store.createRoutine({
      botId: "bot-1",
      name: "Catch up once",
      prompt: "Run the most recent pass",
      schedule: { kind: "interval", everyMinutes: 5 },
    });
    const at = Date.parse("2026-08-14T12:00:00.000Z");
    Object.assign(store.snapshot().routines[0], { nextRunAt: at - 20 * 60_000, catchUpPolicy: "latest" });

    expect(store.claimDueRoutines(at)).toEqual([{
      routineId: routine.id,
      scheduledFor: at,
      outcome: "run",
      skippedOccurrences: 4,
    }]);
    expect(store.snapshot().routines[0]).toMatchObject({
      lastScheduledFor: at,
      lastStatus: "queued",
      nextRunAt: at + 5 * 60_000,
    });
    expect(store.claimDueRoutines(at)).toEqual([]);
  });

  it("records stale work as missed instead of launching it", () => {
    const store = new WorkspaceStore();
    const routine = store.createRoutine({
      botId: "bot-1",
      name: "Do not surprise me",
      prompt: "Only run after a short gap",
      schedule: { kind: "daily", time: "09:00", timezone: "Europe/Rome" },
    });
    const at = Date.parse("2026-08-14T12:00:00.000Z");
    store.snapshot().routines[0].nextRunAt = at - 24 * 60 * 60_000;

    expect(store.claimDueRoutines(at)).toEqual([{
      routineId: routine.id,
      scheduledFor: at - 24 * 60 * 60_000,
      outcome: "missed",
      skippedOccurrences: 0,
    }]);
    expect(store.snapshot().routines[0]).toMatchObject({
      lastStatus: "missed",
      lastError: expect.stringContaining("offline for more than 12 hours"),
    });
  });

  it("advances a persisted duplicate occurrence without dispatching it again", () => {
    const store = new WorkspaceStore();
    store.createRoutine({
      botId: "bot-1",
      name: "Exactly once",
      prompt: "Never duplicate this occurrence",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const at = Date.parse("2026-08-14T12:00:00.000Z");
    Object.assign(store.snapshot().routines[0], { nextRunAt: at, lastScheduledFor: at });
    expect(store.claimDueRoutines(at)).toEqual([]);
    expect(store.snapshot().routines[0].nextRunAt).toBe(at + 30 * 60_000);
  });

  it("preserves an interval anchor when projecting a later calendar window", () => {
    const store = new WorkspaceStore();
    const routine = store.createRoutine({
      botId: "bot-1",
      name: "Anchored",
      prompt: "Keep the original cadence",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const anchor = Date.parse("2026-08-14T10:10:00.000Z");
    store.snapshot().routines[0].nextRunAt = anchor;
    expect(store.projectRoutines(anchor + 35 * 60_000, anchor + 100 * 60_000)).toEqual([
      { routineId: routine.id, scheduledFor: anchor + 60 * 60_000 },
      { routineId: routine.id, scheduledFor: anchor + 90 * 60_000 },
    ]);
  });

  it("globally merges earliest occurrences so one frequent routine cannot consume the limit", () => {
    const store = new WorkspaceStore();
    const fast = store.createRoutine({
      botId: "bot-fast",
      name: "Frequent",
      prompt: "Run frequently",
      schedule: { kind: "interval", everyMinutes: 5 },
    });
    const slower = store.createRoutine({
      botId: "bot-slow",
      name: "Slower",
      prompt: "Run less often",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const from = Date.parse("2026-08-14T10:00:00.000Z");
    store.snapshot().routines.find((routine) => routine.id === fast.id)!.nextRunAt = from;
    store.snapshot().routines.find((routine) => routine.id === slower.id)!.nextRunAt = from + 2 * 60_000;

    expect(store.projectRoutines(from, from + 60 * 60_000, 3)).toEqual([
      { routineId: fast.id, scheduledFor: from },
      { routineId: slower.id, scheduledFor: from + 2 * 60_000 },
      { routineId: fast.id, scheduledFor: from + 5 * 60_000 },
    ]);
  });

  it("filters invisible bot owners before applying the occurrence limit", () => {
    const store = new WorkspaceStore();
    const hidden = store.createRoutine({
      botId: "bot-hidden",
      name: "Hidden frequent routine",
      prompt: "Do not project remotely",
      schedule: { kind: "interval", everyMinutes: 5 },
    });
    const visible = store.createRoutine({
      botId: "bot-visible",
      name: "Visible routine",
      prompt: "Project this one",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const from = Date.parse("2026-08-14T10:00:00.000Z");
    store.snapshot().routines.find((routine) => routine.id === hidden.id)!.nextRunAt = from;
    store.snapshot().routines.find((routine) => routine.id === visible.id)!.nextRunAt = from + 2 * 60_000;

    expect(store.projectRoutines(from, from + 60 * 60_000, 1, new Set(["bot-visible"]))).toEqual([
      { routineId: visible.id, scheduledFor: from + 2 * 60_000 },
    ]);
  });

  it("rejects oversized routine text instead of truncating durable instructions", () => {
    const store = new WorkspaceStore();
    expect(() => store.createRoutine({
      botId: "bot-1",
      name: "n".repeat(101),
      prompt: "Task",
      schedule: { kind: "interval", everyMinutes: 30 },
    })).toThrow(/name is too long/);
    expect(() => store.createRoutine({
      botId: "bot-1",
      name: "Bounded",
      prompt: "p".repeat(20_001),
      schedule: { kind: "interval", everyMinutes: 30 },
    })).toThrow(/task is too long/);
  });

  it("removes a deleted bot's routines and related work without touching other bots", () => {
    const store = new WorkspaceStore();
    const removedFile = join(DATA_DIR, "deleted-bot.txt");
    writeFileSync(removedFile, "delete me");
    const attachment = store.createAttachment({
      botId: "bot-delete",
      threadId: "thread-delete",
      name: "deleted-bot.txt",
      mime: "text/plain",
      size: 9,
      storedPath: removedFile,
    });
    const routine = store.createRoutine({
      botId: "bot-delete",
      name: "Delete this schedule",
      prompt: "Run for the deleted bot",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const task = store.createTask({
      botId: "bot-delete",
      prompt: routine.prompt,
      source: "routine",
      routineId: routine.id,
      attachmentIds: [attachment.id],
    });
    store.createRun(task.id);

    const keptRoutine = store.createRoutine({
      botId: "bot-keep",
      name: "Keep this schedule",
      prompt: "Run for the remaining bot",
      schedule: { kind: "interval", everyMinutes: 60 },
    });
    const keptTask = store.createTask({
      botId: "bot-keep",
      prompt: keptRoutine.prompt,
      source: "routine",
      routineId: keptRoutine.id,
    });
    const keptRun = store.createRun(keptTask.id);

    expect(store.removeBotData("bot-delete")).toEqual({
      attachments: 1,
      tasks: 1,
      runs: 1,
      routines: 1,
    });
    expect(existsSync(removedFile)).toBe(false);

    const snapshot = store.snapshot();
    expect(snapshot.attachments.some((candidate) => candidate.botId === "bot-delete")).toBe(false);
    expect(snapshot.routines).toEqual([keptRoutine]);
    expect(snapshot.tasks).toEqual([expect.objectContaining({ id: keptTask.id, botId: "bot-keep" })]);
    expect(snapshot.runs).toEqual([expect.objectContaining({ id: keptRun.id, botId: "bot-keep" })]);

    const reloaded = new WorkspaceStore().snapshot();
    expect(reloaded.routines).toHaveLength(1);
    expect(reloaded.tasks).toHaveLength(1);
    expect(reloaded.runs).toHaveLength(1);
    expect(JSON.stringify(reloaded)).not.toContain("bot-delete");
  });

  it("keeps bot workspace records when attachment cleanup fails", () => {
    const store = new WorkspaceStore();
    const directory = join(DATA_DIR, "not-an-attachment-file");
    mkdirSync(directory);
    const attachment = store.createAttachment({
      botId: "bot-delete",
      threadId: "thread-delete",
      name: "stuck.txt",
      mime: "text/plain",
      size: 0,
      storedPath: directory,
    });
    const routine = store.createRoutine({
      botId: "bot-delete",
      name: "Still scheduled",
      prompt: "Keep this until deletion can complete",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const task = store.createTask({
      botId: "bot-delete",
      prompt: routine.prompt,
      source: "routine",
      routineId: routine.id,
      attachmentIds: [attachment.id],
    });
    const run = store.createRun(task.id);

    expect(() => store.removeBotData("bot-delete")).toThrow(/could not stage bot attachment stuck.txt/);
    expect(existsSync(directory)).toBe(true);
    expect(store.snapshot()).toMatchObject({
      attachments: [expect.objectContaining({ id: attachment.id })],
      routines: [expect.objectContaining({ id: routine.id })],
      tasks: [expect.objectContaining({ id: task.id })],
      runs: [expect.objectContaining({ id: run.id })],
    });

    const reloaded = new WorkspaceStore().snapshot();
    expect(reloaded.attachments).toHaveLength(1);
    expect(reloaded.routines).toHaveLength(1);
    expect(reloaded.tasks).toHaveLength(1);
    expect(reloaded.runs).toHaveLength(1);
  });

  it("restores attachment bytes and records when workspace.json cannot be committed", () => {
    const store = new WorkspaceStore();
    const file = join(DATA_DIR, "save-failure.txt");
    writeFileSync(file, "keep me");
    const attachment = store.createAttachment({
      botId: "bot-delete",
      threadId: "thread-delete",
      name: "save-failure.txt",
      mime: "text/plain",
      size: 7,
      storedPath: file,
    });
    const routine = store.createRoutine({
      botId: "bot-delete",
      name: "Keep after save failure",
      prompt: "This record must remain retryable",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const workspaceFile = join(DATA_DIR, "workspace.json");
    const backup = join(DATA_DIR, "workspace-backup.json");
    renameSync(workspaceFile, backup);
    mkdirSync(workspaceFile);

    expect(() => store.removeBotData("bot-delete")).toThrow();
    expect(existsSync(file)).toBe(true);
    expect(store.snapshot().attachments).toContainEqual(expect.objectContaining({ id: attachment.id }));
    expect(store.snapshot().routines).toContainEqual(expect.objectContaining({ id: routine.id }));

    rmSync(workspaceFile, { recursive: true });
    renameSync(backup, workspaceFile);
  });

  it("handles daily and weekly schedules in a named timezone", () => {
    const after = Date.parse("2026-08-12T07:00:00.000Z");
    expect(
      new Date(nextOccurrence({ kind: "daily", time: "10:00", timezone: "Europe/Rome" }, after)).toISOString(),
    ).toBe("2026-08-12T08:00:00.000Z");
    expect(
      new Date(
        nextOccurrence({ kind: "weekly", time: "09:00", timezone: "Europe/Rome", weekdays: [1] }, after),
      ).toISOString(),
    ).toBe("2026-08-17T07:00:00.000Z");
  });

  it("rejects unsafe schedule values", () => {
    const store = new WorkspaceStore();
    expect(() =>
      store.createRoutine({
        botId: "bot-1",
        name: "Too fast",
        prompt: "Run constantly",
        schedule: { kind: "interval", everyMinutes: 1 },
      }),
    ).toThrow(/between 5 minutes/);
  });

  it("removes attachment bytes before the record and preserves the record when unlink fails", () => {
    const store = new WorkspaceStore();
    const file = join(DATA_DIR, "rollback.txt");
    writeFileSync(file, "temporary");
    const attachment = store.createAttachment({
      botId: "bot-1",
      threadId: "thread-1",
      name: "rollback.txt",
      mime: "text/plain",
      size: 9,
      storedPath: file,
    });
    expect(store.deleteAttachment(attachment.id)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(store.attachment(attachment.id)).toBeNull();

    const directory = join(DATA_DIR, "cannot-unlink-as-a-file");
    mkdirSync(directory);
    const stuck = store.createAttachment({
      botId: "bot-1",
      threadId: "thread-1",
      name: "stuck.txt",
      mime: "text/plain",
      size: 0,
      storedPath: directory,
    });
    expect(() => store.deleteAttachment(stuck.id)).toThrow(/could not remove attachment file/);
    expect(store.attachment(stuck.id)).toEqual(stuck);
    expect(existsSync(directory)).toBe(true);
  });

  it("enforces persistent attachment count and byte quotas per bot", () => {
    const countStore = new WorkspaceStore();
    for (let index = 0; index < ATTACHMENT_MAX_COUNT_PER_BOT; index += 1) {
      countStore.createAttachment({
        botId: "count-bot",
        threadId: "count-thread",
        name: `${index}.txt`,
        mime: "text/plain",
        size: 1,
        storedPath: join(DATA_DIR, `${index}.txt`),
      });
    }
    expect(countStore.attachmentUsage("count-bot")).toEqual({ count: ATTACHMENT_MAX_COUNT_PER_BOT, bytes: 100 });
    try {
      countStore.assertAttachmentCapacity("count-bot", 1);
      throw new Error("expected count quota rejection");
    } catch (error) {
      expect((error as Error).message).toContain("100 per bot");
      expect((error as { status?: number }).status).toBe(429);
    }

    rmSync(DATA_DIR, { recursive: true, force: true });
    const byteStore = new WorkspaceStore();
    for (let index = 0; index < 10; index += 1) {
      byteStore.createAttachment({
        botId: "byte-bot",
        threadId: "byte-thread",
        name: `${index}.bin`,
        mime: "application/octet-stream",
        size: ATTACHMENT_MAX_BYTES_PER_BOT / 10,
        storedPath: join(DATA_DIR, `${index}.bin`),
      });
    }
    expect(byteStore.attachmentUsage("byte-bot").bytes).toBe(ATTACHMENT_MAX_BYTES_PER_BOT);
    try {
      byteStore.assertAttachmentCapacity("byte-bot", 1);
      throw new Error("expected byte quota rejection");
    } catch (error) {
      expect((error as Error).message).toContain("250 MB per bot");
      expect((error as { status?: number }).status).toBe(413);
    }
    expect(() => byteStore.assertAttachmentCapacity("another-bot", 1)).not.toThrow();
  });
});
