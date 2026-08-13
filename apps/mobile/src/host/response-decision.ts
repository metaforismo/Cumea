export interface HostResponseDecision {
  behavior: "allow" | "deny" | "answer";
  message?: string;
  rememberPolicy?: "allow" | "deny";
}

/** Provider questions are always answers, even when a provider happens to use
 * permission-like labels such as “Allow” or “Never” as question choices. */
export function responseDecision(
  requestType: "permission" | "question",
  choice: string,
): HostResponseDecision {
  if (requestType === "question") return { behavior: "answer", message: choice };

  const allow = ["Allow", "Always allow", "Allow once"].includes(choice);
  return {
    behavior: allow ? "allow" : "deny",
    ...(choice === "Always allow" ? { rememberPolicy: "allow" as const } : {}),
    ...(choice === "Never" ? { rememberPolicy: "deny" as const } : {}),
  };
}
