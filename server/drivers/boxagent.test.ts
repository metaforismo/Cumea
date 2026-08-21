import { describe, expect, it } from "vitest";

import { boxEventText, boxPromptId, boxPromptState } from "./boxagent.ts";

describe("Box agent protocol drift", () => {
  it("takes the prompt run id and never mistakes a top-level Box id for it", () => {
    expect(boxPromptId({ id: "box-123", promptRun: { id: "run-456" } })).toBe("run-456");
    expect(boxPromptId({ id: "box-123", prompt: { id: "legacy-run" } })).toBe("legacy-run");
    expect(boxPromptId({ id: "box-123" })).toBeNull();
  });

  it("accepts current finished/output and legacy completed/result payloads", () => {
    expect(boxPromptState({ promptRun: { status: "finished", output: "done" } })).toEqual({
      status: "finished",
      result: "done",
    });
    expect(boxPromptState({ prompt: { status: "completed", result: "legacy" } })).toEqual({
      status: "completed",
      result: "legacy",
    });
    expect(boxPromptState({ status: "running" }, "partial")).toEqual({ status: "running", result: "partial" });
  });

  it("reads assistant content from current nested event payloads", () => {
    expect(boxEventText({ type: "response", data: { content: "hello" } })).toBe("hello");
    expect(boxEventText({ type: "message", text: "legacy" })).toBe("legacy");
    expect(boxEventText({ data: { content: 42 } })).toBeNull();
  });
});
