import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

// Expand the canonical/public lifecycle with an explicit ambiguous in-flight state.
for (const path of ["server/store.ts", "src/state/store.tsx"]) {
  replaceOnce(
    path,
    'delivery?: "queued" | "failed";',
    'delivery?: "queued" | "dispatching" | "failed";',
    `${path} dispatching delivery`,
  );
}
replaceOnce(
  "server/transcript-navigation.ts",
  'delivery?: "queued" | "failed";',
  'delivery?: "queued" | "dispatching" | "failed";',
  "export dispatching type",
);
replaceOnce(
  "server/transcript-store.ts",
  '  if (message.delivery !== undefined && message.delivery !== "queued" && message.delivery !== "failed") {',
  '  if (message.delivery !== undefined && message.delivery !== "queued" && message.delivery !== "dispatching" && message.delivery !== "failed") {',
  "canonical dispatching validation",
);
replaceOnce(
  "server/mobile.ts",
  '  if (message.delivery === "queued" || message.delivery === "failed") safe.delivery = message.delivery;',
  '  if (message.delivery === "queued" || message.delivery === "dispatching" || message.delivery === "failed") safe.delivery = message.delivery;',
  "mobile dispatching projection",
);
replaceOnce(
  "server/transcript-navigation.ts",
  '    ...(message.delivery === "queued" || message.delivery === "failed" ? { delivery: message.delivery } : {}),',
  '    ...(message.delivery === "queued" || message.delivery === "dispatching" || message.delivery === "failed" ? { delivery: message.delivery } : {}),',
  "export dispatching projection",
);
replaceOnce(
  "server/transcript-navigation.ts",
  '    if (message.delivery === "queued") lines.push("_Queued for the next attended turn._", "");\n    if (message.delivery === "failed") lines.push("_This steering message was not delivered._", "");',
  '    if (message.delivery === "queued") lines.push("_Queued for the next attended turn._", "");\n    if (message.delivery === "dispatching") lines.push("_Steering dispatch was in progress._", "");\n    if (message.delivery === "failed") lines.push("_This steering message was not delivered._", "");',
  "markdown dispatching state",
);
replaceOnce(
  "server/turn-context.ts",
  '        message.delivery !== "queued" &&\n        message.delivery !== "failed" &&',
  '        message.delivery !== "queued" &&\n        message.delivery !== "dispatching" &&\n        message.delivery !== "failed" &&',
  "exclude dispatching transcript rows",
);
replaceOnce(
  "apps/mobile/src/host/host-client.ts",
  'delivery?: "queued" | "failed";',
  'delivery?: "queued" | "dispatching" | "failed";',
  "mobile RawMessage dispatching",
);
replaceOnce(
  "apps/mobile/src/host/host-client.ts",
  '    status: message.delivery === "queued" ? "queued" : message.delivery === "failed" || message.tool?.ok === false ? "error" : "done",',
  '    status: message.delivery === "queued" ? "queued" : message.delivery === "dispatching" ? "sending" : message.delivery === "failed" || message.tool?.ok === false ? "error" : "done",',
  "mobile dispatching status",
);

// Canonical SQLite batch replacement: all rows change in one transaction and
// one revision, or none do.
replaceOnce(
  "server/transcript-store.ts",
  '  private messageRows(threadId: string): TranscriptMessageRow[] {',
  `  replaceMessages(threadId: string, messages: readonly Message[]): number {
    validateThreadId(threadId);
    if (!messages.length) return this.threadState(threadId)?.revision ?? 0;
    const state = this.threadState(threadId);
    if (!state) throw statusError(404, "no such canonical transcript");
    if (state.state !== STATE_ACTIVE) throw statusError(409, "transcript is pending deletion");
    const ids = new Set<string>();
    for (const [index, message] of messages.entries()) {
      validateMessage(message, index);
      if (ids.has(message.id)) throw statusError(400, "duplicate canonical message in batch replacement");
      ids.add(message.id);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const update = this.db.prepare(\`
        UPDATE transcript_messages SET at = ?, payload_json = ?
        WHERE thread_id = ? AND message_id = ?
      \`);
      for (const message of messages) {
        const result = update.run(message.at, JSON.stringify(message), threadId, message.id);
        if (Number(result.changes) !== 1) throw statusError(404, \`no such canonical transcript message \${message.id}\`);
      }
      this.db.prepare("UPDATE transcript_threads SET revision = revision + 1 WHERE thread_id = ?").run(threadId);
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    return this.threadState(threadId)!.revision;
  }

  private messageRows(threadId: string): TranscriptMessageRow[] {`,
  "atomic canonical batch replacement",
);

// Store-level narrow batch API keeps memory/search projections aligned only
// after the canonical transaction commits.
replaceOnce(
  "server/store.ts",
  '  bot(id: string) {',
  `  patchMessageDeliveryBatch(
    threadId: string,
    messageIds: readonly string[],
    delivery?: "queued" | "dispatching" | "failed",
  ): Message[] {
    const uniqueIds = [...new Set(messageIds)];
    if (!uniqueIds.length) return [];
    const list = this.messagesFor(threadId);
    const byId = new Map(list.map((message, index) => [message.id, { message, index }]));
    const replacements = uniqueIds.map((messageId) => {
      const found = byId.get(messageId);
      if (!found) throw Object.assign(new Error(\`no such transcript message \${messageId}\`), { status: 404 });
      return { index: found.index, message: { ...found.message, delivery } as Message };
    });

    if (this.transcripts) {
      const revision = this.transcripts.replaceMessages(threadId, replacements.map((entry) => entry.message));
      for (const entry of replacements) list[entry.index] = entry.message;
      for (const entry of replacements) this.indexMessage(threadId, entry.message, revision);
      return replacements.map((entry) => entry.message);
    }

    for (const entry of replacements) list[entry.index] = entry.message;
    writeFileAtomic(messagesFile(threadId), JSON.stringify(list, null, 2));
    for (const entry of replacements) this.indexMessage(threadId, entry.message);
    return replacements.map((entry) => entry.message);
  }

  bot(id: string) {`,
  "store atomic delivery batch",
);

// Harness protocol: queue -> dispatching durably before external provider work.
replaceOnce(
  "server/index.ts",
  'const steeringDrainInFlight = new Set<string>();\n\nfunction patchSteeringDelivery(threadId: string, messageIds: readonly string[], delivery?: "queued" | "failed") {\n  for (const messageId of messageIds) {\n    const message = store.patchMessage(threadId, messageId, { delivery });\n    if (message) broadcast({ kind: "message.patch", threadId, message });\n  }\n}',
  'const steeringDrainInFlight = new Set<string>();\nconst activeSteeringByThread = new Map<string, string[]>();\n\nfunction patchSteeringDelivery(threadId: string, messageIds: readonly string[], delivery?: "queued" | "dispatching" | "failed") {\n  const messages = store.patchMessageDeliveryBatch(threadId, messageIds, delivery);\n  for (const message of messages) broadcast({ kind: "message.patch", threadId, message });\n}',
  "atomic steering delivery helper",
);
replaceOnce(
  "server/index.ts",
  '  onDispatchAccepted?: () => void;\n  onDispatchFailed?: (error: unknown) => void;',
  '  onDispatchFailed?: (error: unknown) => void;',
  "remove accepted callback",
);
replaceOnce(
  "server/index.ts",
  '      const message = byId.get(messageId);\n      if (!message || message.role !== "user" || message.kind !== "text" || message.delivery !== "queued") {',
  '      const message = byId.get(messageId);\n      if (!message || message.role !== "user" || message.kind !== "text" || message.delivery !== "dispatching") {',
  "validate dispatching steering rows",
);
replaceOnce(
  "server/index.ts",
  '    const attachments = workspace.attachmentsFor(bot.id, group.attachmentIds);\n    await startTurn(bot.id, group.text, {\n      attachments,\n      existingUserMessageIds: group.messageIds,\n      track: true,\n      onDispatchAccepted: () => patchSteeringDelivery(bot.threadId, group.messageIds),\n      onDispatchFailed: (error) => markSteeringFailed(bot, group.messageIds, error, false),\n    });',
  '    const attachments = workspace.attachmentsFor(bot.id, group.attachmentIds);\n    patchSteeringDelivery(bot.threadId, group.messageIds, "dispatching");\n    activeSteeringByThread.set(bot.threadId, [...group.messageIds]);\n    await startTurn(bot.id, group.text, {\n      attachments,\n      existingUserMessageIds: group.messageIds,\n      track: true,\n      onDispatchFailed: (error) => {\n        markSteeringFailed(bot, group.messageIds, error, false);\n        activeSteeringByThread.delete(bot.threadId);\n      },\n    });',
  "durable pre-dispatch transition",
);
replaceOnce(
  "server/index.ts",
  '  } catch (error) {\n    markSteeringFailed(bot, group.messageIds, error, true);\n  } finally {',
  '  } catch (error) {\n    markSteeringFailed(bot, group.messageIds, error, true);\n    activeSteeringByThread.delete(bot.threadId);\n  } finally {',
  "synchronous steering failure cleanup",
);
replaceOnce(
  "server/index.ts",
  '      try { opts.onDispatchAccepted?.(); } catch (callbackError) { console.error("steering dispatch callback failed", callbackError); }\n      if (runId) {',
  '      if (runId) {',
  "remove post-accept persistence",
);
replaceOnce(
  "server/index.ts",
  '      const runId = activeRunByThread.get(event.threadId);\n      if (runId) {\n        workspace.completeRun(runId, event.ok, event.stopReason || (event.ok ? undefined : "Provider run failed"));\n        activeRunByThread.delete(event.threadId);\n        broadcastWorkspace();\n      }\n      store.patchBot(bot.id, { busy: false, unread: true });',
  '      const runId = activeRunByThread.get(event.threadId);\n      if (runId) {\n        workspace.completeRun(runId, event.ok, event.stopReason || (event.ok ? undefined : "Provider run failed"));\n        activeRunByThread.delete(event.threadId);\n        broadcastWorkspace();\n      }\n      const steeringMessageIds = activeSteeringByThread.get(event.threadId);\n      if (steeringMessageIds?.length) {\n        try {\n          patchSteeringDelivery(event.threadId, steeringMessageIds);\n        } catch (error) {\n          console.error("settled steering delivery state could not be persisted", error);\n        } finally {\n          activeSteeringByThread.delete(event.threadId);\n        }\n      }\n      store.patchBot(bot.id, { busy: false, unread: true });',
  "settled steering completion",
);
replaceOnce(
  "server/index.ts",
  '    if (bot.busy) {\n      store.patchBot(bot.id, { busy: false });',
  '    const steeringMessageIds = activeSteeringByThread.get(bot.threadId);\n    if (steeringMessageIds?.length) {\n      try { markSteeringFailed(bot, steeringMessageIds, new Error("provider reload interrupted steering dispatch"), false); }\n      catch (error) { console.error("could not mark interrupted steering after provider reload", error); }\n      activeSteeringByThread.delete(bot.threadId);\n    }\n    if (bot.busy) {\n      store.patchBot(bot.id, { busy: false });',
  "reload active steering failure",
);
replaceOnce(
  "server/index.ts",
  'const steeringRecoveryTimer = setTimeout(() => {\n  for (const bot of store.bots) {\n    if (!queuedSteering(store.messagesFor(bot.threadId)).length) continue;\n    const instance = registry.get(bot.modelSelection.instanceId);',
  'const steeringRecoveryTimer = setTimeout(() => {\n  for (const bot of store.bots) {\n    const messages = store.messagesFor(bot.threadId);\n    const interrupted = messages.filter((message) => message.role === "user" && message.delivery === "dispatching");\n    if (interrupted.length) {\n      try {\n        patchSteeringDelivery(bot.threadId, interrupted.map((message) => message.id), "failed");\n        const activity = store.appendMessage(bot.threadId, {\n          role: "bot",\n          kind: "activity",\n          tool: { name: "steering dispatch was interrupted by restart; retry if still needed", ok: false },\n        });\n        broadcast({ kind: "message", threadId: bot.threadId, message: activity });\n      } catch (error) {\n        console.error("could not reconcile interrupted steering after restart", error);\n      }\n    }\n    if (!queuedSteering(store.messagesFor(bot.threadId)).length) continue;\n    const instance = registry.get(bot.modelSelection.instanceId);',
  "restart dispatching reconciliation",
);
replaceOnce(
  "server/index.ts",
  '      clearThreadEventState(bot.threadId);\n      // Snapshot canonical transcript state while its JSON file is still at',
  '      clearThreadEventState(bot.threadId);\n      activeSteeringByThread.delete(bot.threadId);\n      // Snapshot canonical transcript state while its JSON file is still at',
  "bot delete steering cleanup",
);

// UI labels for the in-flight batch.
replaceOnce(
  "src/components/ChatView.tsx",
  '        {user && message.delivery === "queued" ? (\n          <div className="mt-1.5 text-right text-[10px] text-ink-secondary">Queued · sends after the current turn</div>\n        ) : null}\n        {user && message.delivery === "failed" ? (',
  '        {user && message.delivery === "queued" ? (\n          <div className="mt-1.5 text-right text-[10px] text-ink-secondary">Queued · sends after the current turn</div>\n        ) : null}\n        {user && message.delivery === "dispatching" ? (\n          <div className="mt-1.5 text-right text-[10px] text-ink-secondary">Sending steering…</div>\n        ) : null}\n        {user && message.delivery === "failed" ? (',
  "desktop dispatching label",
);

// New focused tests.
writeFileSync("server/transcript-delivery-batch.test.ts", `import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { TranscriptStore } from "./transcript-store.ts";
import type { Message } from "./store.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function message(id: string, text: string): Message {
  return { id, role: "user", kind: "text", text, at: Date.now(), delivery: "queued" };
}

describe("canonical transcript batch replacement", () => {
  it("commits all delivery changes in one revision", () => {
    const dir = mkdtempSync(join(tmpdir(), "cumea-delivery-batch-"));
    dirs.push(dir);
    const store = new TranscriptStore(join(dir, "transcripts.sqlite"));
    store.ensureImported("thread");
    const a = message("a", "one");
    const b = message("b", "two");
    store.append("thread", a);
    store.append("thread", b);
    const before = store.threadState("thread")!.revision;
    const revision = store.replaceMessages("thread", [
      { ...a, delivery: "dispatching" },
      { ...b, delivery: "dispatching" },
    ]);
    expect(revision).toBe(before + 1);
    expect(store.messagesFor("thread").map((item) => item.delivery)).toEqual(["dispatching", "dispatching"]);
    store.close();
  });

  it("rolls the whole batch back when any message is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cumea-delivery-batch-"));
    dirs.push(dir);
    const store = new TranscriptStore(join(dir, "transcripts.sqlite"));
    store.ensureImported("thread");
    const a = message("a", "one");
    store.append("thread", a);
    const before = store.threadState("thread")!.revision;
    expect(() => store.replaceMessages("thread", [
      { ...a, delivery: "dispatching" },
      message("missing", "missing"),
    ])).toThrow(/missing/);
    expect(store.threadState("thread")!.revision).toBe(before);
    expect(store.messagesFor("thread")[0].delivery).toBe("queued");
    store.close();
  });
});
`);
writeFileSync("server/busy-steering-delivery.test.ts", `import { describe, expect, it } from "vitest";
import { boundedTurnTranscript } from "./turn-context.ts";
import type { Message } from "./store.ts";

const row = (id: string, text: string, delivery?: Message["delivery"]): Message => ({
  id, role: "user", kind: "text", text, at: Date.now(), ...(delivery ? { delivery } : {}),
});

describe("steering delivery transcript boundary", () => {
  it("never replays queued, dispatching, or failed steering as unrelated history", () => {
    const transcript = boundedTurnTranscript([
      row("done", "settled"),
      row("queued", "queued", "queued"),
      row("dispatching", "dispatching", "dispatching"),
      row("failed", "failed", "failed"),
    ]);
    expect(transcript).toEqual([{ role: "user", text: "settled" }]);
  });
});
`);
