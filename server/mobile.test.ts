import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "./contracts.ts";
import {
  decodeMobileComputerPreview,
  publicMobileBot,
  publicMobileMessage,
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
  it("projects permission decisions as one-shot choices only", () => {
    const message: Message = {
      id: "approval-1",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Approval needed",
        subtitle: "Run an action",
        options: ["Always allow", "Allow once", "Never"],
        requestId: "request-1",
        requestType: "permission",
        tool: "shell",
      },
    };
    expect(publicMobileMessage(message)).toMatchObject({ card: { options: ["Allow once", "Deny once"] } });
  });

  it("accepts only bounded PNG/JPEG preview bytes with matching magic", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(decodeMobileComputerPreview(png.toString("base64"), "image/png")?.bytes).toEqual(png);
    expect(decodeMobileComputerPreview(`data:image/png;base64,${png.toString("base64")}`, "image/png")?.bytes).toEqual(png);
    expect(decodeMobileComputerPreview(png.toString("base64"), "image/jpeg")).toBeNull();
    expect(decodeMobileComputerPreview(png.toString("base64"), "image/webp")).toBeNull();
    expect(decodeMobileComputerPreview(Buffer.alloc(20).toString("base64"), "image/png", 8)).toBeNull();
  });

  it("bounds bootstrap messages and strips provider/computer administration", () => {
    const fixture = botFixture();
    fixture.lifecycle = { kind: "temporary", expiresAt: 123_456 };
    const bot = publicMobileBot(fixture, Array.from({ length: 70 }, (_, index) => textMessage(index)));
    expect((bot.messages as unknown[])).toHaveLength(50);
    expect((bot.messages as Array<{ id: string }>)[0].id).toBe("message-20");
    expect(bot.lifecycle).toEqual({ kind: "temporary", expiresAt: 123_456 });
    const encoded = JSON.stringify(bot);
    for (const forbidden of ["modelSelection", "secret-model", "resumeCursors", "secret-session-cursor", "computer", "approvalPolicy"]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("projects parent links, active leaves, and thread changes without provider state", () => {
    const root: Message = { id: "root", parentId: null, role: "user", kind: "text", text: "first", at: 1 };
    const branch: Message = { id: "branch", parentId: "root", role: "user", kind: "text", text: "edited", at: 2 };
    const projected = publicMobileBot(botFixture(), [root, branch], 50, new Set(["bot-1"]), "branch");
    expect(projected).toMatchObject({
      activeLeafId: "branch",
      messages: [
        { id: "root", parentId: null },
        { id: "branch", parentId: "root" },
      ],
    });
    expect(sanitizeRemoteSsePayload({ kind: "thread", threadId: "thread-1", activeLeafId: "branch" })).toEqual({
      kind: "thread",
      threadId: "thread-1",
      activeLeafId: "branch",
    });
    expect(sanitizeRemoteSsePayload({ kind: "thread", threadId: "thread-1", activeLeafId: { secret: true } })).toBeNull();
  });

  it("projects fresh task contexts and queued delivery state without provider routing", () => {
    const fixture = botFixture();
    fixture.context = { id: "context-2", label: "Private research", startedAt: 50 };
    const queued: Message = {
      id: "queued-message",
      parentId: "root",
      role: "user",
      kind: "text",
      text: "Run after the current task",
      delivery: "queued",
      at: 60,
    };
    const projected = publicMobileBot(fixture, [queued], 50, new Set([fixture.id]), "root");
    expect(projected).toMatchObject({
      context: { id: "context-2", label: "Private research", startedAt: 50 },
      messages: [{ id: "queued-message", delivery: "queued" }],
    });
  });

  it("keeps only the message correlation id for queued task projections", () => {
    const projected = publicMobileWorkspace({
      sections: [],
      attachments: [],
      tasks: [{
        id: "task-queue",
        botId: "bot-1",
        title: "secret title",
        prompt: "secret prompt",
        source: "message",
        status: "queued",
        attachmentIds: [],
        messageId: "queued-message",
        createdAt: 10,
        updatedAt: 10,
      }],
      runs: [],
      routines: [],
    }, new Set(["bot-1"]));
    expect(projected.tasks).toEqual([expect.objectContaining({ id: "task-queue", messageId: "queued-message", status: "queued" })]);
    expect(JSON.stringify(projected)).not.toContain("secret title");
    expect(JSON.stringify(projected)).not.toContain("secret prompt");
  });

  it("keeps an older selected branch inside a bounded bootstrap projection", () => {
    const messages: Message[] = [
      { id: "root", parentId: null, role: "bot", kind: "text", text: "root", at: 1 },
      { id: "old-user", parentId: "root", role: "user", kind: "text", text: "old", at: 2 },
      { id: "old-reply", parentId: "old-user", role: "bot", kind: "text", text: "selected", at: 3 },
      ...Array.from({ length: 8 }, (_, index): Message => ({
        id: `new-${index}`,
        parentId: index === 0 ? "root" : `new-${index - 1}`,
        role: index % 2 ? "bot" : "user",
        kind: "text",
        text: `new ${index}`,
        at: 10 + index,
      })),
    ];
    const projected = publicMobileBot(botFixture(), messages, 5, new Set(["bot-1"]), "old-reply");
    const ids = (projected.messages as Array<{ id: string }>).map((message) => message.id);
    expect(ids).toHaveLength(5);
    expect(ids).toEqual(expect.arrayContaining(["root", "old-user", "old-reply"]));
  });

  it("preserves an explicit lifecycle tombstone so companion clients clear their quick badge", () => {
    const projected = sanitizeRemoteSsePayload({
      kind: "bot",
      bot: { ...botFixture(), lifecycle: null },
    });
    expect(projected).toMatchObject({ kind: "bot", bot: { id: "bot-1", lifecycle: null } });
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
      message: { id: "screen-message", parentId: null, role: "bot", kind: "screen", mime: "image/png", at: 1 },
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
          verificationStatus: "verified",
          evidenceRequirements: [{ id: "requirement-1", label: sentinel, createdAt: 4 }],
          budget: { durationMs: 60_000, toolCalls: 3, tokens: 100 },
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
          evidence: [{ id: "evidence-1", requirementId: "requirement-1", level: "verified", source: "verifier", label: sentinel, digest: "sha256:secret-policy-digest", verifier: { id: sentinel, version: sentinel }, recordedAt: 6 }],
          budgetUsage: { startedAt: 5, toolCalls: 1, computerActions: 0, delegations: 0, tokens: 50, tokenBaseline: { input: 1000, output: 100 }, exhaustionReason: "tokens", exhaustedAt: 6 },
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
    for (const forbidden of [sentinel, "storedPath", "secret-token", "prompt", "lastError", "error", "title", "label", "evidenceRequirements", "verificationStatus", "digest", "verifier", "budget", "tokenBaseline"]) {
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

  it("shows only safe checkpoint availability and never mobile resume administration", () => {
    const projected = publicMobileWorkspace({
      tasks: [{ id: "task-interrupted", botId: "bot-1", status: "interrupted", attachmentIds: [], latestRunId: "run-interrupted" }],
      runs: [{
        id: "run-interrupted", taskId: "task-interrupted", botId: "bot-1", status: "interrupted",
        steps: [], artifacts: [], resumeStatus: "available",
        checkpoint: {
          id: "checkpoint-secret-id", provider: { instanceId: "provider-secret", model: "model-secret" },
          cursor: { instanceId: "provider-secret", digest: "sha256:secret-digest" }, activeLeafId: "private-leaf",
        },
      }],
      routines: [], attachments: [], sections: [],
    }, new Set(["bot-1"]));
    expect(projected).toMatchObject({
      tasks: [{ status: "interrupted" }],
      runs: [{ status: "interrupted", resumeAvailable: true }],
    });
    const encoded = JSON.stringify(projected);
    for (const forbidden of ["checkpoint", "provider-secret", "model-secret", "secret-digest", "private-leaf", "resumeUnsafeReason"]) {
      expect(encoded).not.toContain(forbidden);
    }
  });
});
