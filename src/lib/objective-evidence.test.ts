import { describe, expect, it } from "vitest";

import { evidenceDisplayState } from "./objective-evidence";

describe("objective evidence UI state", () => {
  it("does not turn a claim or observation into verification", () => {
    expect(evidenceDisplayState([])).toBe("pending");
    expect(evidenceDisplayState([{ level: "claimed" }])).toBe("claimed");
    expect(evidenceDisplayState([{ level: "claimed" }, { level: "observed" }])).toBe("observed");
  });

  it("shows trusted verification and explicit rejection distinctly", () => {
    expect(evidenceDisplayState([{ level: "verified" }])).toBe("verified");
    expect(evidenceDisplayState([{ level: "verified" }, { level: "rejected" }])).toBe("failed");
  });
});
