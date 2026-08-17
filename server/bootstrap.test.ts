import { describe, expect, it } from "vitest";

import {
  DESKTOP_BOOTSTRAP_BOT_LIMIT,
  DESKTOP_BOOTSTRAP_MESSAGE_BYTES,
  DESKTOP_BOOTSTRAP_MESSAGE_ITEM_BYTES,
  DESKTOP_BOOTSTRAP_MESSAGE_LIMIT,
  buildDesktopBootstrap,
  bootstrapMessagePage,
  bootstrapWorkspace,
  type PublicWorkspaceSnapshot,
} from "./bootstrap.ts";
import type { BotRecord, Message } from "./store.ts";

function bot(index: number): BotRecord {
  return {
    id: `bot-${index}`,
    threadId: `thread-${index}`,
    name: `Bot ${index}`,
    title: "",
    description: "",
    notifications: true,
    color: "green",
    avatar: { kind: "mote", shapeId: "orb", color: "#19ae7a", motion: "calm" },
    unread: false,
    modelSelection: { instanceId: "claude", model: "test" },
    resumeCursors: { claude: `provider-session-${index}` },
    createdAt: index,
  };
}

function message(index: number, patch: Partial<Message> = {}): Message {
  return {
    id: `message-${index}`,
    role: "bot",
    kind: "text",
    text: `message ${index}`,
    at: index,
    ...patch,
  };
}

const workspace = (): PublicWorkspaceSnapshot => ({
  sections: [],
  attachments: [],
  tasks: [],
  runs: [],
  routines: [],
});

function build(patch: Partial<Parameters<typeof buildDesktopBootstrap>[0]> = {}) {
  return buildDesktopBootstrap({
    bots: [bot(0)],
    messagesFor: () => [],
    config: { composio: { configured: false } },
    instances: [],
    workspace: workspace(),
    needsYouCount: 0,
    computerStatus: { cloudConfigured: false, localConfigured: false },
    eventCursor: 0,
    ...patch,
  });
}

describe("desktop bootstrap", () => {
  it("returns the selected page and never exports provider resume cursors", () => {
    const bots = [bot(0), bot(1)];
    const result = build({
      bots,
      selectedBotId: "bot-1",
      messagesFor: (threadId) => threadId === "thread-1" ? [message(1), message(2)] : [],
      eventCursor: 7,
    });
    expect(result.schema).toBe("cumea.desktop-bootstrap");
    expect(result.version).toBe(1);
    expect(result.eventCursor).toBe(7);
    expect(result.selected?.botId).toBe("bot-1");
    expect(result.selected?.page.messages.map((item) => item.id)).toEqual(["message-1", "message-2"]);
    expect(result.bots.every((candidate) => !("resumeCursors" in candidate))).toBe(true);
  });

  it("bounds the bot index while retaining an explicitly selected bot", () => {
    const bots = Array.from({ length: DESKTOP_BOOTSTRAP_BOT_LIMIT + 3 }, (_, index) => bot(index));
    const selected = bots.at(-1)!;
    const result = build({ bots, selectedBotId: selected.id });
    expect(result.bots).toHaveLength(DESKTOP_BOOTSTRAP_BOT_LIMIT);
    expect(result.botsTruncated).toBe(true);
    expect(result.bots.some((candidate) => candidate.id === selected.id)).toBe(true);
  });

  it("reads only the selected transcript when projecting Needs You", () => {
    const result = build({
      bots: [bot(0), bot(1)],
      selectedBotId: "bot-0",
      messagesFor: (threadId) => {
        if (threadId !== "thread-0") throw new Error("unselected transcript scanned");
        return [];
      },
      needsYouCount: 3,
    });
    expect(result.needsYouCount).toBe(3);
  });

  it("bounds the selected transcript by count and encoded bytes", () => {
    const messages = Array.from({ length: DESKTOP_BOOTSTRAP_MESSAGE_LIMIT + 20 }, (_, index) =>
      message(index, { text: "x".repeat(1_000) }),
    );
    const page = bootstrapMessagePage(messages);
    expect(page.messages.length).toBeLessThanOrEqual(DESKTOP_BOOTSTRAP_MESSAGE_LIMIT);
    expect(page.encodedBytes).toBeLessThanOrEqual(DESKTOP_BOOTSTRAP_MESSAGE_BYTES);
    expect(page.hasMore).toBe(true);
  });

  it("drops heavy screen pixels but never truncates oversized canonical text", () => {
    const huge = "x".repeat(DESKTOP_BOOTSTRAP_MESSAGE_ITEM_BYTES + 10_000);
    const page = bootstrapMessagePage([
      message(0, { kind: "screen", text: undefined, png: huge, mime: "image/png" }),
      message(1, { text: huge }),
      message(2, { text: "latest" }),
    ]);
    expect(page.messages.find((item) => item.id === "message-0")?.png).toBeUndefined();
    expect(page.messages.find((item) => item.id === "message-1")).toBeUndefined();
    expect(page.messages.find((item) => item.id === "message-2")?.text).toBe("latest");
    expect(page.omittedOversize).toBe(1);
  });

  it("bounds large workspace histories and reports omitted records", () => {
    const projected = bootstrapWorkspace({
      ...workspace(),
      tasks: Array.from({ length: 260 }, (_, index) => ({
        id: `task-${index}`,
        botId: "bot-0",
        title: `Task ${index}`,
        prompt: "p".repeat(4_000),
        source: "message" as const,
        status: "completed" as const,
        attachmentIds: [],
        createdAt: index,
        updatedAt: index,
      })),
    });
    expect(projected.tasks.length).toBeLessThan(260);
    expect(projected.truncated.tasks).toBe(260 - projected.tasks.length);
  });

  it("rejects invalid monotonic cursors and Needs You counts", () => {
    expect(() => build({ eventCursor: -1 })).toThrow(/event cursor/);
    expect(() => build({ needsYouCount: -1 })).toThrow(/Needs You/);
  });
});
