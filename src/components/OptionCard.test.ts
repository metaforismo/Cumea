import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { OptionCardProjection } from "./OptionCard";

function request(answered?: string): Message {
  return {
    id: "message-1",
    at: 1,
    role: "bot",
    kind: "options",
    card: {
      title: "Approval needed",
      subtitle: "Public request summary",
      options: ["Always allow", "Allow once", "Never"],
      requestId: "request-1",
      requestType: "permission",
      tool: "shell",
      answered,
    },
  };
}

describe("OptionCardProjection", () => {
  it("keeps a pending live request in history without a second action surface", () => {
    const html = renderToStaticMarkup(createElement(OptionCardProjection, { message: request() }));

    expect(html).toContain("Needs you");
    expect(html).toContain("Answer this request in the focused panel below.");
    expect(html).toContain("Always allow");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });

  it("projects the settled answer as read-only history", () => {
    const html = renderToStaticMarkup(createElement(OptionCardProjection, { message: request("Allow once") }));

    expect(html).toContain("Answered: Allow once");
    expect(html).not.toContain("<button");
  });
});
