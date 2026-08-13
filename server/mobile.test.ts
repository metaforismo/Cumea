import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "./contracts.ts";
import {
  decodeMobileComputerPreview,
  publicMobileBot,
  publicMobileWorkspace,
  sanitizeRemoteSsePayload,
} from "./mobile.ts";
import type { BotRecord, Message } from "./store.ts";

function botFixture(): BotRecord {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Guide",
    title: "Chief of staff",
    description: "Helps coordinate work",
    notifications: true,
    color: "orange",
    avatar: { kind: "mote", shapeId: "drop", color: "#ff6b16", motion: "playful" },
    unread: false,
    modelSelection: { instanceId: "provider-secret-instance", model: "secret-model" },
    resumeCursors: { provider: "secret-session-cursor" },
    computer: "cloud",
    appsEnabled: true,
    collaborationEnabled: true,
    approvalPolicy: "allow",
    createdAt: 123,
  };
}

function textMessage(index: number): Message {
  return { id: `message-${index}`, role: "bot", kind: "text", text: `hello ${index}`, at: index };
}

describe("mobile public projections", () => {
  it("accepts only bounded PNG/JPEG preview bytes with matching magic", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(decodeMobileComputerPreview(png.toString("base64"), "image/png")?.bytes).toEqual(png);
    expect(decodeMobileComputerPreview(`data:image/png;base64,${png.toString("base64")}`, "image/png")?.bytes).toEqual(png);
    expect(decodeMobileComputerPreview(png.toString("base64"), "image/jpeg")).toBeNull();
    expect(decodeMobileComputerPreview(png.toString("base64"), "image/webp")).toBeNull();
    expect(decodeMobileComputerPreview(Buffer.alloc(20).toString("base64"), "image/png", 8)).toBeNull();
  });

  it("bounds bootstrap messages and strips provider/computer administration", () => {
    const bot = publicMobileBot(botFixture(), Array.from({ length: 70 }, (_, index) => textMessage(index)));
    expect((bot.messages as unknown[])).toHaveLength(50);
    expect((bot.messages as Array<{ id: string }>)[0].id).toBe("message-20");
    const encoded = JSON.stringify(bot);
    for (const forbidden of ["modelSelection", "secret-model", "resumeCursors", "secret-session-cursor", "computer", "approvalPolicy"]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("redacts handoff peers that are hidden from the paired device", () => {
    const handoff: Message = {
      id: "handoff-message",
      role: "bot",
      kind: "handoff",
      at: 1,
      handoff: {
        fromBotId: "bot-1",
        fromName: "Visible",
        toBotId: "bot-hidden",
        toName: "Private peer",
        prompt: "private handoff prompt",
        reply: "private reply",
        status: "completed",
      },
    };
    const projected = sanitizeRemoteSsePayload(
      { kind: "message", threadId: "thread-1", message: handoff },
      { visibleBotIds: new Set(["bot-1"]) },
    );
    expect(projected).toMatchObject({ kind: "message", message: { id: "handoff-message" } });
    const encoded = JSON.stringify(projected);
    for (const forbidden of ["bot-hidden", "Private peer", "private handoff prompt", "private reply"]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("allowlists minimal runtime events without provider metadata or raw payloads", () => {
    const base = {
      eventId: "event-1",
      provider: "provider-secret",
      providerInstanceId: "instance-secret",
      threadId: "thread-1",
      createdAt: "2026-08-13T00:00:00.000Z",
      turnId: "turn-1",
      raw: { source: "native", payload: { token: "raw-secret" } },
    };
    const delta: RuntimeEvent = { ...base, type: "content.delta", streamKind: "assistant_text", delta: "Hello" };
    expect(sanitizeRemoteSsePayload({ kind: "runtime", event: delta })).toEqual({
      kind: "runtime",
      event: {
        eventId: "event-1",
        threadId: "thread-1",
        createdAt: "2026-08-13T00:00:00.000Z",
        turnId: "turn-1",
        type: "content.delta",
        streamKind: "assistant_text",
        delta: "Hello",
      },
    });
    expect(
      sanitizeRemoteSsePayload({
        kind: "runtime",
        event: { ...base, type: "content.delta", streamKind: "reasoning_text", delta: "private reasoning" },
      }),
    ).toBeNull();
    const completed = sanitizeRemoteSsePayload({
      kind: "runtime",
      event: { ...base, type: "turn.completed", ok: false, cost: 123, denials: ["secret"] },
    });
    expect(completed).toEqual({
      kind: "runtime",
      event: {
        eventId: "event-1",
        threadId: "thread-1",
        createdAt: "2026-08-13T00:00:00.000Z",
        turnId: "turn-1",
        type: "turn.completed",
        ok: false,
      },
    });
    const failed = sanitizeRemoteSsePayload({
      kind: "runtime",
      event: { ...base, type: "runtime.error", message: "token=provider-secret-token" },
    });
    expect(JSON.stringify(failed)).not.toContain("provider-secret-token");
  });

  it("removes inline screenshots and drops local-only event families", () => {
    const screenMessage: Message = {
      id: "screen-message",
      role: "bot",
      kind: "screen",
      png: "data:image/png;base64,very-secret-screen",
      mime: "image/png",
      at: 1,
    };
    const safeMessage = sanitizeRemoteSsePayload({
      kind: "message",
      threadId: "thread-1",
      message: screenMessage,
    });
    expect(safeMessage).toEqual({
      kind: "message",
      threadId: "thread-1",
      message: { id: "screen-message", role: "bot", kind: "screen", mime: "image/png", at: 1 },
    });
    expect(sanitizeRemoteSsePayload({ kind: "screen", png: "secret" })).toBeNull();
    expect(sanitizeRemoteSsePayload({ kind: "config", xai: { key: "secret" } })).toBeNull();
    expect(sanitizeRemoteSsePayload({ kind: "instances", instances: [{ provider: "secret" }] })).toBeNull();
    expect(sanitizeRemoteSsePayload({ kind: "computer", token: "secret" })).toBeNull();
    const activity = sanitizeRemoteSsePayload({
      kind: "message",
      threadId: "thread-1",
      message: {
        id: "activity-message",
        role: "bot",
        kind: "activity",
        tool: { name: "error: provider instance secret-provider failed", ok: false },
        at: 2,
      },
    });
    expect(activity).toMatchObject({ message: { tool: { name: "Action failed", ok: false } } });
    expect(JSON.stringify(activity)).not.toContain("secret-provider");
  });

  it("sanitizes bot and workspace envelopes defensively", () => {
    const safeBot = sanitizeRemoteSsePayload({ kind: "bot", bot: botFixture() });
    expect(JSON.stringify(safeBot)).not.toContain("secret");

    const sentinel = "Authorization: Bearer workspace-provider-sentinel";
    const workspace = sanitizeRemoteSsePayload({
      kind: "workspace",
      workspace: {
        sections: [{ id: "section-1", name: "Operations", createdAt: 1 }],
        attachments: [{
          id: "attachment-1",
          botId: "bot-1",
          name: "report.txt",
          mime: "text/plain",
          size: 10,
          createdAt: 2,
          storedPath: "/private/secret",
          token: "secret-token",
        }],
        tasks: [{
          id: "task-1",
          botId: "bot-1",
          title: sentinel,
          prompt: sentinel,
          source: "message",
          status: "needs_attention",
          attachmentIds: ["attachment-1"],
          latestRunId: "run-1",
          createdAt: 3,
          updatedAt: 4,
        }],
        runs: [{
          id: "run-1",
          taskId: "task-1",
          botId: "bot-1",
          status: "needs_attention",
          error: sentinel,
          steps: [{ id: "step-1", kind: "approval", title: sentinel, status: "needs_attention", startedAt: 5 }],
          artifacts: [{ id: "artifact-1", kind: "attachment", label: sentinel, attachmentId: "attachment-1", createdAt: 6 }],
          startedAt: 5,
        }],
        routines: [{
          id: "routine-1",
          botId: "bot-1",
          name: "Inbox pass",
          prompt: sentinel,
          schedule: { kind: "interval", everyMinutes: 30 },
          enabled: true,
          nextRunAt: 100,
          createdAt: 7,
          updatedAt: 8,
          lastStatus: "failed",
          lastError: sentinel,
        }],
      },
    });
    expect(workspace).toMatchObject({
      kind: "workspace",
      workspace: {
        attachments: [{ id: "attachment-1", botId: "bot-1", name: "report.txt" }],
        tasks: [{ id: "task-1", botId: "bot-1", status: "needs_attention", needsAttention: true }],
        runs: [{
          id: "run-1",
          status: "needs_attention",
          needsAttention: true,
          steps: [{ id: "step-1", kind: "approval", status: "needs_attention", needsAttention: true }],
        }],
        routines: [{ id: "routine-1", name: "Inbox pass", lastStatus: "failed" }],
      },
    });
    const encoded = JSON.stringify(workspace);
    for (const forbidden of [sentinel, "storedPath", "secret-token", "prompt", "lastError", "error", "title", "label"]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("filters durable work for hidden bots when given the visible bot set", () => {
    const projected = publicMobileWorkspace({
      tasks: [
        { id: "visible-task", botId: "bot-1", status: "running", attachmentIds: [] },
        { id: "hidden-task", botId: "bot-hidden", status: "running", attachmentIds: [] },
      ],
      runs: [],
      routines: [],
      attachments: [],
      sections: [],
    }, new Set(["bot-1"]));
    expect(projected.tasks).toEqual([
      expect.objectContaining({ id: "visible-task", botId: "bot-1", status: "running" }),
    ]);
    expect(JSON.stringify(projected)).not.toContain("hidden-task");
  });
});
