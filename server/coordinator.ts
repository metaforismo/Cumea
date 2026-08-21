/**
 * Coordinator guidance is deliberately a role overlay, not a new execution
 * path. The ordinary turn owner, permission broker, depth cap and visible
 * handoff transcript remain the security and accounting boundaries.
 */
export interface CoordinatorTeamMember {
  id: string;
  name: string;
  title?: string;
  description?: string;
  busy?: boolean;
  hidden?: boolean;
}

export function coordinatorSystemPrompt(
  coordinatorId: string,
  bots: CoordinatorTeamMember[],
  hasPeerTools: boolean,
): string {
  const team = bots.filter((bot) => bot.id !== coordinatorId && !bot.hidden);
  const roster = team.length
    ? team.map((bot) => {
        const role = bot.title?.trim() || "General assistant";
        const about = bot.description?.trim();
        return `- ${bot.name} — ${role}${about ? `: ${about}` : ""} (${bot.busy ? "working right now" : "available"})`;
      }).join("\n")
    : "- No other visible agents are available yet.";
  const role =
    " You are the workspace Coordinator. Clarify the outcome, split complex work into bounded pieces, keep ownership of the user-facing result, and synthesize peer findings into one coherent answer. Do simple work directly; delegation is useful only when a specialist can materially improve speed or quality.";
  const delegation = hasPeerTools
    ? role +
        " Use list_bots before delegating, choose the smallest relevant set of peers, give each one a concrete non-overlapping task, and verify their output before relying on it. Never ask a peer to recruit another peer and never present raw handoff chatter as the final answer."
    : role +
        " Peer-agent tools are not available for this turn, so complete the work directly and do not claim that another agent was consulted.";
  return `${delegation}\nCurrent visible workspace team:\n${roster}`;
}
