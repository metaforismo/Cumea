export interface CardResponseDecision {
  behavior: "allow" | "deny" | "answer";
  message?: string;
  rememberPolicy?: "allow" | "deny";
}

/** Translate a card response by request kind, never by option wording alone. */
export function cardResponseDecision(
  requestType: "permission" | "question" | undefined,
  answer: string,
): CardResponseDecision {
  if (requestType !== "permission") return { behavior: "answer", message: answer };

  const allow = ["Allow", "Always allow", "Allow once"].includes(answer);
  return {
    behavior: allow ? "allow" : "deny",
    ...(answer === "Always allow" ? { rememberPolicy: "allow" as const } : {}),
    ...(answer === "Never" ? { rememberPolicy: "deny" as const } : {}),
  };
}
