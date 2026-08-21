import { describe, expect, it } from "vitest";

import { coordinatorSystemPrompt } from "./coordinator.ts";

describe("coordinatorSystemPrompt", () => {
  it("keeps the coordinator accountable while bounding peer delegation", () => {
    const prompt = coordinatorSystemPrompt("coordinator", [
      { id: "coordinator", name: "Ada" },
      { id: "research", name: "Lin", title: "Research", description: "Finds primary sources", busy: true },
      { id: "hidden", name: "Secret", hidden: true },
    ], true);
    expect(prompt).toContain("workspace Coordinator");
    expect(prompt).toContain("Use list_bots before delegating");
    expect(prompt).toContain("concrete non-overlapping task");
    expect(prompt).toContain("verify their output");
    expect(prompt).toContain("Never ask a peer to recruit another peer");
    expect(prompt).toContain("Lin — Research: Finds primary sources (working right now)");
    expect(prompt).not.toContain("Secret");
  });

  it("fails closed to direct work when peer tools are absent", () => {
    const prompt = coordinatorSystemPrompt("coordinator", [{ id: "coordinator", name: "Ada" }], false);
    expect(prompt).toContain("complete the work directly");
    expect(prompt).toContain("do not claim that another agent was consulted");
    expect(prompt).toContain("No other visible agents are available yet");
  });
});
