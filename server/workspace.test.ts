import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

  it("keeps provider attention separate from watchdog recovery state", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-1", prompt: "Long task" });
    const run = store.createRun(task.id);
    store.setRunLifecycle(run.id, {
      threadId: "thread-1",
      runId: run.id,
      state: "no_signal",
      lastActivityAt: 1_000,
    });
    store.markLifecycleAttention(run.id, {
      threadId: "thread-1",
      runId: run.id,
      kind: "no_signal",
      title: "No signal",
      observedAt: 2_000,
    });
    expect(store.run(run.id)).toMatchObject({ status: "needs_attention", attentionKind: "lifecycle" });

    store.markNeedsAttention(run.id, "Approve send?", "request-1");
    expect(store.run(run.id)).toMatchObject({ status: "needs_attention", attentionKind: "provider" });
    expect(store.run(run.id)?.lifecycleAlert).toBeUndefined();

    store.setRunLifecycle(run.id, {
      threadId: "thread-1",
      runId: run.id,
      state: "working",
      lastActivityAt: 3_000,
    });
    expect(store.run(run.id)).toMatchObject({ status: "needs_attention", attentionKind: "provider" });
    store.resumeRun(run.id, "request-1", false);
    expect(store.run(run.id)).toMatchObject({ status: "running", attentionKind: undefined });
  });

  it("auto-clears recovered silence alerts but keeps repeated-effect alerts visible", () => {
    const store = new WorkspaceStore();
    const firstTask = store.createTask({ botId: "bot-1", prompt: "Silent task" });
    const firstRun = store.createRun(firstTask.id);
    store.markLifecycleAttention(firstRun.id, {
      threadId: "thread-1", runId: firstRun.id, kind: "dead", title: "No runtime signal", observedAt: 1_000,
    });
    store.setRunLifecycle(firstRun.id, {
      threadId: "thread-1", runId: firstRun.id, state: "working", lastActivityAt: 2_000,
    });
    expect(store.run(firstRun.id)).toMatchObject({ status: "running", attentionKind: undefined });
    expect(store.run(firstRun.id)?.steps.at(-1)).toMatchObject({ kind: "lifecycle", status: "completed" });

    const secondTask = store.createTask({ botId: "bot-1", prompt: "Loop task" });
    const secondRun = store.createRun(secondTask.id);
    store.markLifecycleAttention(secondRun.id, {
      threadId: "thread-2", runId: secondRun.id, kind: "repeated_effect", title: "Repeated action", observedAt: 3_000, repeatCount: 6,
    });
    store.setRunLifecycle(secondRun.id, {
      threadId: "thread-2", runId: secondRun.id, state: "working", lastActivityAt: 4_000,
    });
    expect(store.run(secondRun.id)).toMatchObject({ status: "needs_attention", attentionKind: "lifecycle" });
    expect(store.run(secondRun.id)?.lifecycleAlert?.kind).toBe("repeated_effect");
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
