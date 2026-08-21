import { describe, expect, it } from "vitest";

import { messageVersions, visibleMessages, type Message } from "./store";

const message = (id: string, parentId: string | null, role: Message["role"], at: number): Message => ({
  id,
  parentId,
  role,
  kind: "text",
  text: id,
  at,
});

describe("desktop conversation branches", () => {
  it("renders only the selected root-to-leaf path and lists sibling user revisions", () => {
    const root = message("root", null, "bot", 1);
    const first = message("first", "root", "user", 2);
    const firstReply = message("first-reply", "first", "bot", 3);
    const edit = message("edit", "root", "user", 4);
    const editReply = message("edit-reply", "edit", "bot", 5);
    const messages = [root, first, firstReply, edit, editReply];

    expect(visibleMessages({ messages, activeLeafId: "edit-reply" }).map((item) => item.id)).toEqual([
      "root",
      "edit",
      "edit-reply",
    ]);
    expect(messageVersions({ messages }, edit).map((item) => item.id)).toEqual(["first", "edit"]);
  });

  it("bounds malformed cycles instead of hanging the renderer", () => {
    const messages = [message("a", "b", "bot", 1), message("b", "a", "user", 2)];
    expect(visibleMessages({ messages, activeLeafId: "a" }).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("does not present queued or cancelled work as editable versions", () => {
    const root = message("root", null, "bot", 1);
    const active = message("active", "root", "user", 2);
    const queued = { ...message("queued", "root", "user", 3), delivery: "queued" as const };
    const cancelled = { ...message("cancelled", "root", "user", 4), delivery: "cancelled" as const };
    expect(messageVersions({ messages: [root, active, queued, cancelled] }, active).map((item) => item.id)).toEqual(["active"]);
  });
});
