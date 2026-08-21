import { describe, expect, it } from "vitest";

import { checkpointContinuationInput, checkpointCursorDigest, createRunCheckpoint, planCheckpointResume, validRunCheckpoint } from "./run-checkpoint.ts";

function available() {
  const checkpoint = createRunCheckpoint({
    runId: "run-1", taskId: "task-1", botId: "bot-1", activeLeafId: "message-1",
    instanceId: "claude-1", model: "sonnet", cursor: { session: "private-cursor" }, now: 10,
  });
  checkpoint.phase = "turn_accepted";
  checkpoint.status = "available";
  delete checkpoint.unsafeReason;
  return checkpoint;
}

describe("run checkpoints", () => {
  it("stores only a bounded cursor digest", () => {
    const checkpoint = available();
    expect(checkpoint.cursor?.digest).toMatch(/^sha256:/);
    expect(JSON.stringify(checkpoint)).not.toContain("private-cursor");
    expect(checkpointCursorDigest({ session: "private-cursor" })).toBe(checkpoint.cursor?.digest);
    expect(validRunCheckpoint(checkpoint, { id: "run-1", taskId: "task-1", botId: "bot-1" })).toBe(true);
  });

  it("uses a cursor only for an exact provider, model, capability, leaf and digest match", () => {
    const checkpoint = available();
    const base = {
      checkpoint, activeLeafId: "message-1", providerAvailable: true, currentInstanceId: "claude-1",
      currentModel: "sonnet", currentCursor: { session: "private-cursor" }, sessionResumeCapable: true, unsafeEffects: false,
    };
    expect(planCheckpointResume(base)).toEqual({ allowed: true, useProviderCursor: true });
    expect(planCheckpointResume({ ...base, currentCursor: "stale" })).toEqual({ allowed: true, useProviderCursor: false });
    expect(planCheckpointResume({ ...base, currentInstanceId: "codex-1" })).toEqual({ allowed: true, useProviderCursor: false });
  });

  it("fails closed for branch mismatch, unavailable provider and unknown effects", () => {
    const checkpoint = available();
    const base = {
      checkpoint, activeLeafId: "message-1", providerAvailable: true, currentInstanceId: "claude-1",
      currentModel: "sonnet", currentCursor: null, sessionResumeCapable: true, unsafeEffects: false,
    };
    expect(planCheckpointResume({ ...base, activeLeafId: "message-2" }).reason).toBe("branch_mismatch");
    expect(planCheckpointResume({ ...base, providerAvailable: false }).reason).toBe("provider_unavailable");
    expect(planCheckpointResume({ ...base, unsafeEffects: true }).reason).toBe("unknown_effect");
  });

  it("rejects hostile fields and inconsistent lifecycle linkage", () => {
    const checkpoint = available();
    const owner = { id: "run-1", taskId: "task-1", botId: "bot-1" };
    expect(validRunCheckpoint({ ...checkpoint, provider: { ...checkpoint.provider, payload: "raw" } }, owner)).toBe(false);
    expect(validRunCheckpoint({ ...checkpoint, cursor: { ...checkpoint.cursor, raw: "secret" } }, owner)).toBe(false);
    expect(validRunCheckpoint({ ...checkpoint, updatedAt: checkpoint.createdAt - 1 }, owner)).toBe(false);
    expect(validRunCheckpoint({ ...checkpoint, resumedByRunId: "run-2" }, owner)).toBe(false);
    expect(validRunCheckpoint({ ...checkpoint, status: "consumed" }, owner)).toBe(false);
    expect(validRunCheckpoint({ ...checkpoint, status: "consumed", resumedByRunId: "run-2" }, owner)).toBe(true);
  });

  it("replays the surviving canonical path only for a fresh provider session", () => {
    const survivingTranscript = [
      { role: "user" as const, text: "Original task" },
      { role: "assistant" as const, text: "Partial durable progress" },
    ];
    const fresh = checkpointContinuationInput({ survivingTranscript, useProviderCursor: false });
    expect(fresh.transcript).toEqual(survivingTranscript);
    expect(fresh.text).not.toContain("Original task");
    expect(fresh.text).toContain("do not repeat completed external actions");

    const native = checkpointContinuationInput({ survivingTranscript, useProviderCursor: true });
    expect(native.transcript).toEqual([]);
    expect(native.text).toBe(fresh.text);
  });
});
