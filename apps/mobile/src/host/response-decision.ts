export interface HostResponseDecision {
  behavior: "allow" | "deny" | "answer";
  message?: string;
}

/** Provider questions are always answers, even when a provider happens to use
 * permission-like labels such as “Allow” or “Never” as question choices. */
export function responseDecision(
  requestType: "permission" | "question",
  choice: string,
): HostResponseDecision {
  if (requestType === "question") return { behavior: "answer", message: choice };

  const allow = ["Allow", "Always allow", "Allow once"].includes(choice);
  // A paired device can settle this pending request, but durable authority is
  // administered only from the desktop host.
  return { behavior: allow ? "allow" : "deny" };
}
