import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { PendingRequestPanel } from "./PendingRequestPanel";

function pending(requestType: "permission" | "question" = "permission") {
  const message: Message = {
    id: "message-1",
    at: 1,
    role: "bot",
    kind: "options",
    card: {
      title: requestType === "permission" ? "Approval needed" : "Choose a release window",
      subtitle: requestType === "permission" ? "git push origin release" : "The task is waiting for a date.",
      options: requestType === "permission" ? ["Always allow", "Allow once", "Never"] : ["Monday", "Tuesday"],
      requestId: "request-1",
      requestType,
      tool: requestType === "permission" ? "shell" : undefined,
    },
  };
  return { message, requestId: "request-1", requestType } as const;
}

describe("PendingRequestPanel", () => {
  it("renders one focused decision region with exact server-projected choices", () => {
    const html = renderToStaticMarkup(createElement(PendingRequestPanel, {
      botName: "Guide",
      request: pending(),
      count: 3,
      busy: true,
      onAnswer: async () => {},
      onStop: () => {},
    }));

    expect(html).toContain('role="region"');
    expect(html).toContain("Guide needs approval");
    expect(html).toContain("1 of 3");
    expect(html).toContain("Always allow");
    expect(html).toContain("Allow once");
    expect(html).toContain("Never");
    expect(html).toContain("git push origin release");
    expect(html).toContain("Escape does not answer or dismiss");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("Type your answer");
  });

  it("keeps question choices and an explicit custom-answer path", () => {
    const html = renderToStaticMarkup(createElement(PendingRequestPanel, {
      botName: "Guide",
      request: pending("question"),
      count: 1,
      busy: false,
      onAnswer: async () => {},
      onStop: () => {},
    }));

    expect(html).toContain("Guide needs your answer");
    expect(html).toContain("1 of 1");
    expect(html).toContain("Monday");
    expect(html).toContain("Tuesday");
    expect(html).toContain("Type your answer");
    expect(html).toContain('maxLength="4000"');
    expect(html).not.toContain("Stop task");
  });
});
