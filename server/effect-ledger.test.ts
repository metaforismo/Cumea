import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "./config.ts";
import { classifyOpaquePotentialEffect, effectRequestHash, ExternalEffectNotAppliedError } from "./effect-ledger.ts";
import { publicMobileWorkspace } from "./mobile.ts";
import { publicPersistenceIssues } from "./persistence-health.ts";
import { WorkspaceStore } from "./workspace.ts";

function activeRun(store: WorkspaceStore, botId = "bot-effect") {
  const task = store.createTask({ botId, prompt: "Apply one external change" });
  return { task, run: store.createRun(task.id) };
}

describe("external-effect ledger", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("persists intended and applying before executing, then stores only bounded result metadata", async () => {
    const store = new WorkspaceStore();
    const { run } = activeRun(store);
    const secret = "secret-request-value-that-must-not-be-stored";
    const operation = vi.fn(async () => {
      const disk = JSON.parse(readFileSync(join(DATA_DIR, "workspace.json"), "utf8"));
      expect(disk.runs[0].effects[0].state).toBe("applying");
      expect(JSON.stringify(disk)).not.toContain(secret);
      return { id: "remote-123", body: "private response body" };
    });

    const result = await store.executeExternalEffect(run.id, {
      boundary: "calendar.create",
      action: "create",
      targetHint: "team calendar",
      request: { title: secret },
    }, operation);

    expect(operation).toHaveBeenCalledOnce();
    expect(result.effect).toMatchObject({ state: "applied", result: { ok: true, reference: "remote-123" } });
    const persisted = readFileSync(join(DATA_DIR, "workspace.json"), "utf8");
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain("private response body");
    expect(result.effect.requestHash).toBe(effectRequestHash({ title: secret }));
  });

  it("reconciles an applied duplicate without executing it twice", async () => {
    const store = new WorkspaceStore();
    const { run } = activeRun(store);
    const input = { boundary: "mail.send", action: "send", request: { template: "weekly" } };
    await store.executeExternalEffect(run.id, input, async () => ({ id: "message-1" }));
    store.completeRun(run.id, true);
    const duplicateRun = store.createRun(store.run(run.id)!.taskId);
    const duplicateOperation = vi.fn(async () => ({ id: "message-2" }));

    const duplicate = await store.executeExternalEffect(duplicateRun.id, input, duplicateOperation);

    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.value).toBeUndefined();
    expect(duplicateOperation).not.toHaveBeenCalled();
    expect(duplicate.effect.audit.at(-1)?.event).toBe("duplicate");
  });

  it("creates a new failed retry identity unless a destination key owns idempotency", async () => {
    const store = new WorkspaceStore();
    const { run } = activeRun(store);
    const input = { boundary: "storage.upload", action: "upload", request: { digest: "sha256:file" } };
    await expect(store.executeExternalEffect(run.id, input, async () => { throw new ExternalEffectNotAppliedError("rejected"); })).rejects.toThrow(/confirmed/i);
    const first = store.run(run.id)!.effects![0];
    expect(first).toMatchObject({ state: "failed", result: { code: "rejected" } });
    await expect(store.executeExternalEffect(run.id, input, async () => { throw new ExternalEffectNotAppliedError("rejected"); })).rejects.toThrow(/confirmed/i);
    const second = store.run(run.id)!.effects![1];
    expect(second).toMatchObject({ attempt: 2, retryOf: first.id });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);

    const keyedRun = activeRun(store).run;
    const keyed = { ...input, destinationIdempotencyKey: "destination-owned-key" };
    await expect(store.executeExternalEffect(keyedRun.id, keyed, async () => { throw new ExternalEffectNotAppliedError("rejected"); })).rejects.toThrow();
    const keyedFirst = store.run(keyedRun.id)!.effects![0];
    await expect(store.executeExternalEffect(keyedRun.id, keyed, async () => { throw new ExternalEffectNotAppliedError("rejected"); })).rejects.toThrow();
    const keyedSecond = store.run(keyedRun.id)!.effects![1];
    expect(keyedSecond.idempotencyKey).toBe(keyedFirst.idempotencyKey);
    expect(readFileSync(join(DATA_DIR, "workspace.json"), "utf8")).not.toContain("destination-owned-key");
  });

  it("recovers applying as unknown and blocks duplicate replay until a local resolution", () => {
    const store = new WorkspaceStore();
    const { run } = activeRun(store);
    const input = { boundary: "calendar.delete", action: "delete", request: { event: 7 } };
    const begun = store.beginExternalEffect(run.id, input);
    expect(begun.kind).toBe("ready");
    if (begun.kind !== "ready") throw new Error("unreachable");
    store.markExternalEffectApplying(begun.effect.id);

    const reloaded = new WorkspaceStore();
    const recovered = reloaded.externalEffect(begun.effect.id)!;
    expect(recovered.state).toBe("unknown");
    expect(recovered.audit.at(-1)?.event).toBe("restart_unknown");
    expect(reloaded.hasUnsafeEffects(run.id)).toBe(true);
    const retryRun = reloaded.createRun(reloaded.run(run.id)!.taskId);
    expect(reloaded.beginExternalEffect(retryRun.id, input).kind).toBe("blocked");

    expect(() => reloaded.resolveExternalEffect(recovered.id, "failed", "sk-abcdefghijklmnopqrstuvwxyz123456")).toThrow(/must not contain secrets/i);
    reloaded.resolveExternalEffect(recovered.id, "failed", "Checked the calendar audit log");
    expect(reloaded.hasUnsafeEffects(run.id)).toBe(false);
    expect(reloaded.beginExternalEffect(retryRun.id, input)).toMatchObject({ kind: "ready", effect: { attempt: 2, retryOf: recovered.id } });
  });

  it("treats a timeout after a possible remote apply as unknown and never replays it", async () => {
    const store = new WorkspaceStore();
    const { task, run } = activeRun(store);
    const input = { boundary: "mail.send", action: "send", request: { template: "notice" } };
    let remoteApplications = 0;
    await expect(store.executeExternalEffect(run.id, input, async () => {
      remoteApplications += 1;
      throw new Error("Timeout");
    })).rejects.toThrow("Timeout");

    expect(store.run(run.id)?.effects?.[0]).toMatchObject({ state: "unknown", result: { code: "Error" } });
    const retryRun = store.createRun(task.id);
    const replay = vi.fn(async () => { remoteApplications += 1; });
    await expect(store.executeExternalEffect(retryRun.id, input, replay)).rejects.toMatchObject({ status: 409 });
    expect(replay).not.toHaveBeenCalled();
    expect(remoteApplications).toBe(1);
  });

  it("keeps an acknowledged effect unknown when durable settlement fails", async () => {
    const store = new WorkspaceStore();
    const { run } = activeRun(store);
    const originalSave = (store as unknown as { save: () => void }).save.bind(store);
    (store as unknown as { save: () => void }).save = () => {
      if (store.run(run.id)?.effects?.some((effect) => effect.state === "applied")) throw new Error("disk unavailable");
      originalSave();
    };

    await expect(store.executeExternalEffect(
      run.id,
      { boundary: "calendar.create", action: "create", request: { title: "safe" } },
      async () => ({ id: "remote-created" }),
    )).rejects.toThrow(/durable receipt requires local review/i);
    expect(store.run(run.id)?.effects?.[0].state).toBe("unknown");
    expect(new WorkspaceStore().run(run.id)?.effects?.[0].state).toBe("unknown");
  });

  it("records only conservative opaque integration writes as unknown observations", () => {
    expect(classifyOpaquePotentialEffect("shell rm file")).toBeNull();
    expect(classifyOpaquePotentialEffect("mcp__calendar__list_events")).toBeNull();
    expect(classifyOpaquePotentialEffect("mcp__memory__write")).toBeNull();
    expect(classifyOpaquePotentialEffect("mcp__filesystem__delete_file")).toBeNull();
    const descriptor = classifyOpaquePotentialEffect("mcp__calendar__create_event");
    expect(descriptor).toEqual({ boundary: "calendar.create_event", action: "create_event" });

    const store = new WorkspaceStore();
    const { run } = activeRun(store);
    const effect = store.observeOpaqueExternalEffect(run.id, { descriptor: descriptor!, itemId: "provider-tool-1" });
    expect(effect).toMatchObject({ origin: "provider_observation", state: "unknown" });
    expect(store.observeOpaqueExternalEffect(run.id, { descriptor: descriptor!, itemId: "provider-tool-1" }).id).toBe(effect.id);
  });

  it("marks a pre-boundary intended receipt failed on restart so it is retryable", () => {
    const store = new WorkspaceStore();
    const { task, run } = activeRun(store);
    const input = { boundary: "mail.send", action: "send", request: { template: "notice" } };
    const begun = store.beginExternalEffect(run.id, input);
    expect(begun.kind).toBe("ready");

    const reloaded = new WorkspaceStore();
    expect(reloaded.run(run.id)?.effects?.[0]).toMatchObject({ state: "failed", result: { code: "abandoned_before_apply" } });
    const retryRun = reloaded.createRun(task.id);
    expect(reloaded.beginExternalEffect(retryRun.id, input)).toMatchObject({ kind: "ready", effect: { attempt: 2 } });
  });

  it("degrades safely and blocks writes on forged or malformed persisted receipts", async () => {
    const store = new WorkspaceStore();
    const { run } = activeRun(store);
    await store.executeExternalEffect(run.id, { boundary: "mail.send", action: "send", request: { template: "safe" } }, async () => ({ id: "remote" }));
    const path = join(DATA_DIR, "workspace.json");
    const disk = JSON.parse(readFileSync(path, "utf8"));
    disk.runs[0].effects[0].rawRequest = { password: "forged-secret" };
    const forgedEffectId = disk.runs[0].effects[0].id as string;
    const forgedBytes = JSON.stringify(disk);
    writeFileSync(path, forgedBytes);

    const degraded = new WorkspaceStore();
    expect(degraded.snapshot()).toEqual({ sections: [], attachments: [], tasks: [], runs: [], routines: [] });
    expect(degraded.externalEffect(forgedEffectId)).toBeNull();
    expect(degraded.hasUnsafeEffects(run.id)).toBe(false);
    expect(publicPersistenceIssues()).toContainEqual(expect.objectContaining({
      store: "Workspace, tasks, runs, routines and receipts",
      file: "workspace.json",
      kind: "invalid_schema",
      writesBlocked: true,
    }));
    expect(readFileSync(path, "utf8")).toBe(forgedBytes);
    expect(() => degraded.createTask({ botId: "bot-forged", prompt: "must remain blocked" })).toThrow(expect.objectContaining({ status: 503 }));
    expect(readFileSync(path, "utf8")).toBe(forgedBytes);
    expect(degraded.externalEffect(forgedEffectId)).toBeNull();
  });

  it("prevents owner deletion while a controlled effect is crossing its boundary", () => {
    const store = new WorkspaceStore();
    const { run } = activeRun(store, "bot-delete-effect");
    const begun = store.beginExternalEffect(run.id, { boundary: "mail.send", action: "send", request: { template: "notice" } });
    if (begun.kind !== "ready") throw new Error("unreachable");
    store.markExternalEffectApplying(begun.effect.id);

    expect(() => store.removeBotData("bot-delete-effect")).toThrow(/external effect/i);
    expect(store.externalEffect(begun.effect.id)?.state).toBe("applying");
    store.confirmExternalEffectNotApplied(begun.effect.id, "cancelled");
    expect(store.removeBotData("bot-delete-effect").runs).toBe(1);
  });

  it("exposes only safe effect counts to paired mobile", () => {
    const sentinel = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const projected = publicMobileWorkspace({
      sections: [], attachments: [], tasks: [], routines: [],
      runs: [{
        id: "run-mobile", taskId: "task-mobile", botId: "bot-mobile", status: "running", steps: [], artifacts: [],
        effects: [{ state: "unknown", requestHash: sentinel, idempotencyKey: sentinel, descriptor: { targetHint: "private target" }, audit: [{ note: "private audit" }] }],
        startedAt: 1,
      }],
    });
    expect(projected.runs).toEqual([expect.objectContaining({ effectSummary: { count: 1, unsafe: 1 } })]);
    expect(JSON.stringify(projected)).not.toContain(sentinel);
    expect(JSON.stringify(projected)).not.toContain("private target");
    expect(JSON.stringify(projected)).not.toContain("private audit");
  });
});
