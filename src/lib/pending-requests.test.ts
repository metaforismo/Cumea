import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { pendingRequests } from "./pending-requests";

function request(
  id: string,
  at: number,
  patch: Partial<NonNullable<Message["card"]>> = {},
): Message {
  return {
    id,
    at,
    role: "bot",
    kind: "options",
    card: {
      title: "Approval needed",
      subtitle: "Public request summary",
      options: ["Always allow", "Allow once", "Never"],
      requestId: `request-${id}`,
      requestType: "permission",
      tool: "shell",
      ...patch,
    },
  };
}

describe("pendingRequests", () => {
  it("returns only unresolved live provider requests", () => {
    const messages: Message[] = [
      request("live", 4),
      request("answered", 2, { answered: "Allow once" }),
      request("dismissed", 3, { dismissed: true }),
      { ...request("onboarding", 1), card: { title: "Question", subtitle: "Choose", options: ["A"] } },
      { id: "text", at: 0, role: "user", kind: "text", text: "hello" },
    ];

    expect(pendingRequests(messages).map((item) => item.message.id)).toEqual(["live"]);
  });

  it("orders oldest first and preserves transcript order for equal timestamps", () => {
    const messages = [request("later", 20), request("first-tie", 10), request("second-tie", 10)];

    expect(pendingRequests(messages).map((item) => item.message.id)).toEqual([
      "first-tie",
      "second-tie",
      "later",
    ]);
  });

  it("does not invent or reorder provider choices", () => {
    const options = ["Review first", "Proceed once"];
    const [pending] = pendingRequests([
      request("question", 1, { requestType: "question", options }),
    ]);

    expect(pending.requestType).toBe("question");
    expect(pending.message.card?.options).toEqual(options);
  });
});

