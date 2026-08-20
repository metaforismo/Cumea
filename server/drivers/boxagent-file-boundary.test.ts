import { describe, expect, it } from "vitest";
import { boxAgentSystemPrompt, HOST_FILE_PREVIEW_INSTRUCTION } from "./boxagent.ts";

describe("box agent file boundary", () => {
  it("removes the host-local file preview instruction from cloud turns", () => {
    const system = `persona${HOST_FILE_PREVIEW_INSTRUCTION} connected apps`;
    const sanitized = boxAgentSystemPrompt(system);
    expect(sanitized).toBe("persona connected apps");
    expect(sanitized).not.toContain("current working directory");
    expect(sanitized).not.toContain("safe preview");
  });

  it("preserves unrelated system instructions", () => {
    expect(boxAgentSystemPrompt("persona and safety rules")).toBe("persona and safety rules");
    expect(boxAgentSystemPrompt(undefined)).toBeUndefined();
  });
});
