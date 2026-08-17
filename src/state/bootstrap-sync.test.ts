import { describe, expect, it } from "vitest";

import {
  framesAfterCursor,
  materializeDesktopBootstrap,
  mergeThreadMessages,
  parseCursorFrame,
  type DesktopBootstrap,
} from "./bootstrap-sync";

function snapshot(): DesktopBootstrap {
  return {
    schema: "cumea.desktop-bootstrap",
    version: 1,
    eventCursor: 10,
    bots: [
      {
        id: "bot-a",
        threadId: "thread-a",
        name: "A",
        title: "",
        description: "",
        notifications: true,
        color: "green",
        avatar: { kind: "mote", shapeId: "orb", color: "#19ae7a", motion: "calm" },
        unread: false,
        modelSelection: { instanceId: "claude", model: "test" },
      },
      {
        id: "bot-b",
        threadId: "thread-b",
        name: "B",
        title: "",
        description: "",
        notifications: true,
        color: "blue",
        avatar: { kind: "mote", shapeId: "soft", color: "#2f8de3", motion: "calm" },
        unread: false,
        modelSelection: { instanceId: "claude", model: "test" },
      },
    ],
    botsTruncated: false,
    selected: {
      botId: "bot-b",
      threadId: "thread-b",
      page: {
        messages: [{ id: "m1", role: "bot", kind: "text", text: "hello", at: 1 }],
        nextBefore: null,
        hasMore: false,
        omittedOversize: 0,
        encodedBytes: 10,
      },
    },
    config: { composio: { configured: false }, box: { configured: false } },
    instances: [],
    workspace: {
      sections: [],
      attachments: [],
      tasks: [],
      runs: [],
      routines: [],
      truncated: { sections: 0, attachments: 0, tasks: 0, runs: 0, routines: 0 },
    },
    needsYouCount: 0,
    computerStatus: { cloudConfigured: false, localConfigured: false },
  };
}

describe("desktop bootstrap sync", () => {
  it("hydrates only the selected transcript and preserves the selected id", () => {
    const materialized = materializeDesktopBootstrap(snapshot());
    expect(materialized.selectedId).toBe("bot-b");
    expect(materialized.bots.find((bot) => bot.id === "bot-a")?.messages).toEqual([]);
    expect(materialized.bots.find((bot) => bot.id === "bot-b")?.messages[0]?.id).toBe("m1");
    expect(materialized.workspaceComplete).toBe(true);
  });

  it("marks a truncated startup workspace for a later full reload", () => {
    const value = snapshot();
    value.workspace.truncated.tasks = 4;
    expect(materializeDesktopBootstrap(value).workspaceComplete).toBe(false);
  });

  it("drops buffered duplicates already represented by the snapshot cursor", () => {
    const frames = [
      { kind: "bot", eventCursor: 9 },
      { kind: "bot", eventCursor: 10 },
      { kind: "message", eventCursor: 11 },
      { kind: "workspace", eventCursor: 12 },
      { kind: "workspace", eventCursor: 12 },
    ];
    expect(framesAfterCursor(frames, 10).map((frame) => frame.eventCursor)).toEqual([11, 12]);
  });

  it("keeps newer renderer copies when a lazy transcript page races SSE", () => {
    const fetched = [
      { id: "m1", role: "bot" as const, kind: "text" as const, text: "old", at: 1 },
      { id: "m2", role: "bot" as const, kind: "text" as const, text: "two", at: 2 },
    ];
    const existing = [
      { id: "m1", role: "bot" as const, kind: "text" as const, text: "patched", at: 1 },
      { id: "m3", role: "bot" as const, kind: "text" as const, text: "new SSE", at: 3 },
    ];
    const merged = mergeThreadMessages(existing, fetched);
    expect(merged.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
    expect(merged.find((message) => message.id === "m1")?.text).toBe("patched");
  });

  it("rejects frames without a trustworthy monotonic cursor", () => {
    expect(parseCursorFrame({ kind: "bot", eventCursor: 4 })).toMatchObject({ eventCursor: 4 });
    expect(parseCursorFrame({ kind: "bot" })).toBeNull();
    expect(parseCursorFrame({ kind: "bot", eventCursor: -1 })).toBeNull();
  });
});
