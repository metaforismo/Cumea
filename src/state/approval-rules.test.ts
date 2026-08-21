import { describe, expect, it } from "vitest";

import { approvalRuleBoundary, withoutApprovalRule, type PublicApprovalRule } from "./approval-rules";

const rules: PublicApprovalRule[] = [
  { id: "git", key: "v1:command:bash:git", tool: "bash", program: "git", decision: "allow", updatedAt: 1 },
  { id: "calendar", key: "v1:tool:calendar.read", tool: "calendar.read", decision: "deny", updatedAt: 2 },
];

describe("approval rule UI state", () => {
  it("shows the command program boundary instead of a whole command", () => {
    expect(approvalRuleBoundary(rules[0])).toBe("bash:git");
    expect(approvalRuleBoundary(rules[1])).toBe("calendar.read");
  });

  it("removes only the host-confirmed scoped grant", () => {
    expect(withoutApprovalRule(rules, "git")).toEqual([rules[1]]);
    expect(withoutApprovalRule(rules, "missing")).toEqual(rules);
  });
});
