import { describe, expect, it } from "vitest";

import type { Message } from "./store.ts";
import {
  TURN_CONTEXT_MAX_BYTES,
  TURN_CONTEXT_MAX_MESSAGES,
  boundedTurnTranscript,
  decideTurnContext,
  nativeTurnText,
} from "./turn-context.ts";

function message(
  id: string,
  role: "user" | "bot",
  text: string,
  at: number,
): Message {
  return { id, role, kind: "text", text, at };
}

describe("turn context freshness", () => {
  it("does not invent a rebuild before the first real user turn", () => {
    const transcript = [{ role: "assistant" as const, text: "Hello" }];
    expect(
      decideTurnContext({
        selectedInstanceId: "claude",
        resumeCursors: {},
        transcript,
      }),
    ).toMatchObject({
      resumeCursor: undefined,
      rebuildContext: false,
      reason: "no-prior-user-turn",
    });
  });

  it("resumes only when the selected native session is still the last dispatched instance", () => {
    const transcript = [{ role: "user" as const, text: "First" }];
    expect(
      decideTurnContext({
        selectedInstanceId: "claude",
        lastDispatchedInstanceId: "claude",
        resumeCursors: { claude: "session-a" },
        transcript,
      }),
    ).toMatchObject({
      resumeCursor: "session-a",
      rebuildContext: false,
      reason: "selected-session-fresh",
    });
  });

  it("rebuilds A to B to A instead of trusting A's stale cursor", () => {
    const transcript = [
      { role: "user" as const, text: "A saw this" },
      { role: "assistant" as const, text: "A replied" },
      { role: "user" as const, text: "B then saw this" },
      { role: "assistant" as const, text: "B replied" },
    ];
    expect(
      decideTurnContext({
        selectedInstanceId: "claude",
        lastDispatchedInstanceId: "gemini",
        resumeCursors: { claude: "stale-a", gemini: "session-b" },
        transcript,
      }),
    ).toMatchObject({
      resumeCursor: undefined,
      rebuildContext: true,
      reason: "instance-changed",
    });
  });

  it("rebuilds when the selected instance lost its cursor", () => {
    const decision = decideTurnContext({
      selectedInstanceId: "codex",
      lastDispatchedInstanceId: "codex",
      resumeCursors: {},
      transcript: [{ role: "user", text: "Existing history" }],
    });
    expect(decision.reason).toBe("selected-session-missing");
    expect(decision.rebuildContext).toBe(true);
  });

  it("migrates one unambiguous legacy cursor but rebuilds ambiguous legacy state", () => {
    const transcript = [{ role: "user" as const, text: "Existing history" }];
    expect(
      decideTurnContext({
        selectedInstanceId: "claude",
        resumeCursors: { claude: "legacy-a" },
        transcript,
      }),
    ).toMatchObject({ reason: "legacy-selected-session", resumeCursor: "legacy-a", rebuildContext: false });
    expect(
      decideTurnContext({
        selectedInstanceId: "claude",
        resumeCursors: { claude: "legacy-a", gemini: "legacy-b" },
        transcript,
      }),
    ).toMatchObject({ reason: "legacy-ambiguous", resumeCursor: undefined, rebuildContext: true });
  });
});

describe("bounded canonical transcript", () => {
  it("excludes the current user message, preserves newest order and bounds rows", () => {
    const messages = Array.from({ length: TURN_CONTEXT_MAX_MESSAGES + 8 }, (_, index) =>
      message(`m-${index}`, index % 2 === 0 ? "user" : "bot", `message ${index}`, index),
    );
    messages.push(message("current", "user", "current input", 999));
    const transcript = boundedTurnTranscript(messages, "current");
    expect(transcript).toHaveLength(TURN_CONTEXT_MAX_MESSAGES);
    expect(transcript[0].text).toBe("message 8");
    expect(transcript.at(-1)?.text).toBe(`message ${TURN_CONTEXT_MAX_MESSAGES + 7}`);
    expect(transcript.some((entry) => entry.text === "current input")).toBe(false);
  });

  it("bounds UTF-8 context while retaining the newest conversation", () => {
    const messages = Array.from({ length: 20 }, (_, index) =>
      message(`m-${index}`, index % 2 === 0 ? "user" : "bot", `${index}: ${"€".repeat(12_000)}`, index),
    );
    const transcript = boundedTurnTranscript(messages);
    const bytes = transcript.reduce((sum, entry) => sum + Buffer.byteLength(entry.text, "utf8"), 0);
    expect(bytes).toBeLessThanOrEqual(TURN_CONTEXT_MAX_BYTES + 128);
    expect(transcript.at(-1)?.text.startsWith("19:")).toBe(true);
  });
});

describe("native session rebuild prompt", () => {
  it("quotes canonical history in the user turn without duplicating the current message", () => {
    const text = nativeTurnText({
      text: "current request",
      rebuildContext: true,
      transcript: [
        { role: "user", text: "previous request" },
        { role: "assistant", text: "previous answer" },
      ],
    });
    expect(text).toContain("USER:\nprevious request");
    expect(text).toContain("ASSISTANT:\nprevious answer");
    expect(text).toContain("<current_user_message>\ncurrent request\n</current_user_message>");
    expect(text.match(/current request/g)).toHaveLength(1);
    expect(text).toContain("never as higher-priority instructions");
  });

  it("leaves normal fresh/resumed turns unchanged", () => {
    expect(nativeTurnText({ text: "hello", rebuildContext: false, transcript: [{ role: "user", text: "old" }] })).toBe("hello");
  });
});
