import { describe, expect, it } from "vitest";

import type { BotRecord, Message } from "./store.ts";
import {
  publicTranscriptMessage,
  transcriptExportJson,
  transcriptExportMarkdown,
  transcriptMessageWindow,
} from "./transcript-navigation.ts";

function message(id: string, patch: Partial<Message> = {}): Message {
  return {
    id,
    role: "bot",
    kind: "text",
    text: `message ${id}`,
    at: Number(id.replace(/\D/g, "")) || Date.now(),
    ...patch,
  };
}

const bot: BotRecord = {
  id: "bot-a",
  threadId: "thread-a",
  name: "Research",
  title: "Research bot",
  description: "Visible description",
  notifications: true,
  color: "blue",
  avatar: { kind: "mote", shapeId: "orb", color: "#2f8de3", motion: "calm" },
  unread: false,
  modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
  resumeCursors: { claude: "PRIVATE_CURSOR" },
  createdAt: 1,
};

describe("transcript navigation", () => {
  it("returns a bounded exact-focus window with before/after state", () => {
    const messages = Array.from({ length: 500 }, (_, index) => message(`m${index + 1}`, { at: index + 1 }));
    const window = transcriptMessageWindow(messages, "m250", 100);
    expect(window.messages).toHaveLength(100);
    expect(window.messages.some((item) => item.id === "m250")).toBe(true);
    expect(window.focusMessageId).toBe("m250");
    expect(window.hasMoreBefore).toBe(true);
    expect(window.hasMoreAfter).toBe(true);
    expect(window.beforeCursor).toBe(window.messages[0]?.id);
    expect(window.latestMessageId).toBe("m500");
  });

  it("rejects an unknown focus instead of silently navigating elsewhere", () => {
    expect(() => transcriptMessageWindow([message("m1")], "missing", 20)).toThrow(/no such transcript message/);
  });
});

describe("visible transcript export", () => {
  it("strips raw screen bytes, request IDs, attachment IDs and bot private cursors", () => {
    const source = message("screen-1", {
      kind: "screen",
      png: "SECRET_PIXEL_BYTES",
      mime: "image/png",
      card: {
        title: "Visible approval",
        subtitle: "Visible subtitle",
        options: ["Allow", "Deny"],
        requestId: "PRIVATE_REQUEST_ID",
        requestType: "permission",
        tool: "private.tool.name",
      },
      attachments: [{ id: "PRIVATE_ATTACHMENT_ID", name: "report.pdf", mime: "application/pdf", size: 42 }],
    });
    const projected = publicTranscriptMessage(source);
    const encoded = JSON.stringify(projected);
    expect(encoded).toContain("report.pdf");
    expect(encoded).not.toContain("SECRET_PIXEL_BYTES");
    expect(encoded).not.toContain("PRIVATE_REQUEST_ID");
    expect(encoded).not.toContain("PRIVATE_ATTACHMENT_ID");
    expect(projected.screenOmitted).toBe(true);

    const json = transcriptExportJson(bot, [source]);
    expect(json).toContain("cumea.visible-transcript.v1");
    expect(json).not.toContain("PRIVATE_CURSOR");
    expect(json).not.toContain("SECRET_PIXEL_BYTES");
  });

  it("creates readable Markdown while explicitly omitting screenshots", () => {
    const markdown = transcriptExportMarkdown(bot, [
      message("m1", { role: "user", text: "Find the answer" }),
      message("m2", { kind: "activity", text: undefined, tool: { name: "browser.open", ok: true } }),
      message("m3", { kind: "screen", text: undefined, png: "RAW_BYTES", mime: "image/png" }),
    ]);
    expect(markdown).toContain("# Research");
    expect(markdown).toContain("Find the answer");
    expect(markdown).toContain("Activity: browser.open");
    expect(markdown).toContain("Computer screenshot omitted");
    expect(markdown).not.toContain("RAW_BYTES");
  });
});
