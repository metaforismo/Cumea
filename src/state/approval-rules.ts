export interface PublicApprovalRule {
  id: string;
  key: string;
  tool: string;
  program?: string;
  decision: "allow" | "deny";
  updatedAt: number;
}

export function approvalRuleBoundary(rule: PublicApprovalRule): string {
  return rule.program ? `${rule.tool}:${rule.program}` : rule.tool;
}

/** Apply a host-confirmed revoke without touching neighboring tool grants. */
export function withoutApprovalRule(rules: PublicApprovalRule[], ruleId: string): PublicApprovalRule[] {
  return rules.filter((rule) => rule.id !== ruleId);
}
