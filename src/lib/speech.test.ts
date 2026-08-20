import { describe, expect, it } from "vitest";
import { speechIssueFor } from "./speech";

describe("speechIssueFor", () => {
  it("keeps a clean completion silent", () => {
    expect(speechIssueFor("completed", 0)).toBeNull();
    expect(speechIssueFor(undefined, 0)).toBeNull();
  });

  it("offers the exact macOS settings pane for permission failures", () => {
    expect(speechIssueFor("speech-not-authorized", 1)).toMatchObject({ settingsPane: "speech" });
    expect(speechIssueFor("mic-failed", 1)).toMatchObject({ settingsPane: "mic" });
  });

  it("keeps helper/native detail out of generic failures", () => {
    expect(speechIssueFor("recognition-error", 1)?.message).toMatch(/Dictation stopped/);
    expect(speechIssueFor("helper-exited", 1)?.message).toMatch(/unexpectedly/);
    expect(speechIssueFor(undefined, 1)?.message).toMatch(/unexpectedly/);
  });
});
