import { describe, expect, it } from "vitest";

import { cardResponseDecision } from "../src/state/response-decision.ts";

describe("desktop card response decisions", () => {
  it("keeps permission-like question labels as answers", () => {
    expect(cardResponseDecision("question", "Never")).toEqual({ behavior: "answer", message: "Never" });
    expect(cardResponseDecision("question", "Allow")).toEqual({ behavior: "answer", message: "Allow" });
  });

  it("only remembers policy for permission requests", () => {
    expect(cardResponseDecision("permission", "Always allow")).toEqual({
      behavior: "allow",
      rememberPolicy: "allow",
    });
    expect(cardResponseDecision("permission", "Never")).toEqual({
      behavior: "deny",
      rememberPolicy: "deny",
    });
  });
});
