import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BotResourceGate, TurnEventFence, shouldCleanupStaleProvision } from "./bot-resource-gate.ts";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function rejectingDeferred(): { promise: Promise<void>; reject: (error: Error) => void } {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}

describe("per-bot resource deletion gate", () => {
  it("drains an admitted upload before deletion removes its late bytes", async () => {
    const gate = new BotResourceGate();
    const finishUpload = deferred();
    const uploadEntered = deferred();
    const bytes = new Set<string>();
    const events: string[] = [];

    const upload = gate.run("bot-race", async () => {
      events.push("upload-entered");
      uploadEntered.resolve();
      await finishUpload.promise;
      bytes.add("late-upload.txt");
      events.push("upload-committed");
    });
    await uploadEntered.promise;

    const barrier = gate.beginDeletion("bot-race");
    expect(gate.isDeleting("bot-race")).toBe(true);
    expect(() => gate.acquire("bot-race")).toThrow(/being deleted/);

    let deletionFinished = false;
    const deletion = (async () => {
      await barrier.idle;
      bytes.clear();
      events.push("bytes-deleted");
      deletionFinished = true;
      barrier.release();
    })();
    await Promise.resolve();
    expect(deletionFinished).toBe(false);

    finishUpload.resolve();
    await Promise.all([upload, deletion]);
    expect(bytes).toEqual(new Set());
    expect(events).toEqual(["upload-entered", "upload-committed", "bytes-deleted"]);
  });

  it("orders capability revocation before bot.deleted and rejects a late resolver", async () => {
    const gate = new BotResourceGate();
    const finishResolve = deferred();
    const resolveEntered = deferred();
    const capabilities = new Set<string>();
    const events: string[] = [];

    const resolve = gate.run("bot-preview", async () => {
      resolveEntered.resolve();
      await finishResolve.promise;
      capabilities.add("opaque-capability");
      events.push("capability-issued");
    });
    await resolveEntered.promise;

    const barrier = gate.beginDeletion("bot-preview");
    const deletion = (async () => {
      await barrier.idle;
      capabilities.clear();
      events.push("capabilities-revoked", "bot.deleted");
      barrier.release();
    })();
    await expect(gate.run("bot-preview", async () => undefined)).rejects.toThrow(/being deleted/);

    finishResolve.resolve();
    await Promise.all([resolve, deletion]);
    expect(capabilities).toEqual(new Set());
    expect(events).toEqual(["capability-issued", "capabilities-revoked", "bot.deleted"]);
  });

  it("reopens cleanly when the delete transaction rolls back", async () => {
    const gate = new BotResourceGate();
    const staleDetached = gate.beginDetachedOperation("bot-retry");
    const barrier = gate.beginDeletion("bot-retry");
    await barrier.idle;
    barrier.release();

    expect(staleDetached.isCurrent()).toBe(false);
    staleDetached.release();
    await expect(gate.run("bot-retry", async () => "available")).resolves.toBe("available");
    const retryDetached = gate.beginDetachedOperation("bot-retry");
    expect(retryDetached.isCurrent()).toBe(true);
    retryDetached.release();
    expect(gate.isDeleting("bot-retry")).toBe(false);
  });

  it("does not strand deletion when an admitted operation rejects", async () => {
    const gate = new BotResourceGate();
    await expect(gate.run("bot-abort", async () => {
      throw new Error("request aborted");
    })).rejects.toThrow("request aborted");

    const barrier = gate.beginDeletion("bot-abort");
    await expect(barrier.idle).resolves.toBeUndefined();
    barrier.release();
  });

  it("cancels a detached turn held in provisioning before it can send or recreate a deleted transcript", async () => {
    const gate = new BotResourceGate();
    const store = new Store(() => ({ instanceId: "test", model: "test-model" }));
    const bot = store.createBot();
    const provisioning = deferred();
    const operation = gate.beginDetachedOperation(bot.id);
    const transcriptPath = join(DATA_DIR, `messages-${bot.threadId}.json`);
    let sendTurnCalls = 0;

    const detachedTurn = (async () => {
      try {
        await provisioning.promise;
        if (!operation.isCurrent()) return;
        sendTurnCalls += 1;
      } catch {
        if (operation.isCurrent()) {
          store.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: "provider failure" } });
        }
      } finally {
        operation.release();
      }
    })();

    // Canonical DELETE invalidates detached work synchronously and does not
    // wait for a potentially 90-second provisioning request.
    const deletion = gate.beginDeletion(bot.id);
    await deletion.idle;
    expect(store.deleteBot(bot.id)).toBe(true);
    deletion.release();

    provisioning.resolve();
    await detachedTurn;
    expect(sendTurnCalls).toBe(0);
    expect(existsSync(transcriptPath)).toBe(false);
  });

  it("drops an approval rejection that arrives after canonical deletion", async () => {
    const gate = new BotResourceGate();
    const store = new Store(() => ({ instanceId: "test", model: "test-model" }));
    const bot = store.createBot();
    const providerResponse = rejectingDeferred();
    const operation = gate.beginDetachedOperation(bot.id);
    const transcriptPath = join(DATA_DIR, `messages-${bot.threadId}.json`);

    const response = providerResponse.promise
      .catch(() => {
        if (operation.isCurrent()) {
          store.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: "approval policy failed" } });
        }
      })
      .finally(operation.release);

    const deletion = gate.beginDeletion(bot.id);
    await deletion.idle;
    expect(store.deleteBot(bot.id)).toBe(true);
    deletion.release();

    providerResponse.reject(new Error("late provider rejection"));
    await response;
    expect(existsSync(transcriptPath)).toBe(false);
  });

  it("serializes temporary-to-permanent conversion with deletion", async () => {
    const gate = new BotResourceGate();
    const store = new Store(() => ({ instanceId: "test", model: "test-model" }));
    const bot = store.createBot({ lifecycle: { kind: "temporary", expiresAt: Date.now() + 60_000 } });
    const bodyRead = deferred();
    const bodyEntered = deferred();

    const conversion = gate.run(bot.id, async () => {
      bodyEntered.resolve();
      await bodyRead.promise;
      if (gate.isDeleting(bot.id)) return null;
      return store.setBotLifecycle(bot.id, null);
    });
    await bodyEntered.promise;

    const deletion = gate.beginDeletion(bot.id);
    let deleteAdmitted = false;
    const deleting = deletion.idle.then(() => {
      deleteAdmitted = true;
      expect(store.deleteBot(bot.id)).toBe(true);
      deletion.release();
    });
    await Promise.resolve();
    expect(deleteAdmitted).toBe(false);
    await expect(gate.run(bot.id, async () => store.setBotLifecycle(bot.id, null))).rejects.toThrow(/being deleted/);

    bodyRead.resolve();
    expect(await conversion).toBeNull();
    await deleting;
    expect(store.bot(bot.id)).toBeNull();
  });

  it("suppresses a late provisioning result and runs cleanup exactly once", async () => {
    const gate = new BotResourceGate();
    const provisioning = deferred();
    const operation = gate.beginDetachedOperation("bot-route-provision");
    let exposedBoxId: string | null = null;
    let cleanupCalls = 0;

    const request = (async () => {
      let cleanupAttempted = false;
      const cleanup = async () => {
        if (cleanupAttempted) return;
        cleanupAttempted = true;
        cleanupCalls += 1;
      };
      try {
        await provisioning.promise;
        if (!operation.isCurrent()) {
          await cleanup();
          throw new Error("deleted while provisioning");
        }
        exposedBoxId = "sensitive-box-id";
      } catch (error) {
        if (!operation.isCurrent()) await cleanup();
        throw error;
      } finally {
        operation.release();
      }
    })();

    const deletion = gate.beginDeletion("bot-route-provision");
    await deletion.idle;
    deletion.release();
    provisioning.resolve();

    await expect(request).rejects.toThrow(/deleted while provisioning/);
    expect(exposedBoxId).toBeNull();
    expect(cleanupCalls).toBe(1);
  });

  it("never cleans a stale provision after rollback or owner replacement", () => {
    const restoredOwner = { id: "bot-rollback" };
    const replacementOwner = { id: "bot-rollback" };

    expect(shouldCleanupStaleProvision(restoredOwner)).toBe(false);
    expect(shouldCleanupStaleProvision(replacementOwner)).toBe(false);
    expect(shouldCleanupStaleProvision(null)).toBe(true);
  });

  it("never lets a pre-delete provider event claim or complete a post-rollback turn", () => {
    const fence = new TurnEventFence();
    const oldTurn = fence.begin("thread-rollback", "turn-old");
    expect(oldTurn.markDispatching()).toBe(true);
    expect(fence.accepts("thread-rollback", "turn.started", "turn-old")).toBe(true);

    // DELETE invalidates synchronously. A transaction rollback may reopen the
    // bot, but it must not reopen this provider event generation.
    fence.invalidate("thread-rollback");
    const newTurn = fence.begin("thread-rollback", "turn-new");
    expect(newTurn.markDispatching()).toBe(true);

    const persisted: string[] = [];
    let newRunCompleted = false;
    const fold = (type: string, turnId: string, text?: string) => {
      if (!fence.accepts("thread-rollback", type, turnId)) return;
      if (text) persisted.push(text);
      if (type === "turn.completed") newRunCompleted = true;
    };

    // The old first event cannot claim the new dispatch because ids are issued
    // by the harness before either asynchronous provider call begins.
    fold("turn.started", "turn-old");
    fold("item.completed", "turn-old", "stale assistant reply");
    fold("turn.completed", "turn-old");
    expect(persisted).toEqual([]);
    expect(newRunCompleted).toBe(false);

    fold("turn.started", "turn-new");
    expect(fence.isAccepted("thread-rollback", "turn-new")).toBe(true);
    expect(fence.isAccepted("thread-rollback", "turn-old")).toBe(false);
    fold("item.completed", "turn-new", "fresh reply");
    fold("turn.completed", "turn-new");
    expect(persisted).toEqual(["fresh reply"]);
    expect(newRunCompleted).toBe(true);
  });

  it("drops events emitted after a rejected provider dispatch", () => {
    const fence = new TurnEventFence();
    const admission = fence.begin("thread-rejected", "turn-rejected");
    expect(admission.markDispatching()).toBe(true);
    // startTurn catch/finally invalidates whenever sendTurn did not bind.
    admission.invalidate();
    expect(fence.accepts("thread-rejected", "turn.started", "turn-rejected")).toBe(false);
    expect(fence.accepts("thread-rejected", "item.completed", "turn-rejected")).toBe(false);
    expect(fence.accepts("thread-rejected", "turn.completed", "turn-rejected")).toBe(false);
  });
});
