import { describe, expect, it } from "vitest";
import { boundedTurnTranscript } from "./turn-context.ts";
import type { Message } from "./store.ts";

const row = (id: string, text: string, delivery?: Message["delivery"]): Message => ({
  id, role: "user", kind: "text", text, at: Date.now(), ...(delivery ? { delivery } : {}),
});

describe("steering delivery transcript boundary", () => {
  it("never replays queued, dispatching, or failed steering as unrelated history", () => {
    const transcript = boundedTurnTranscript([
      row("done", "settled"),
      row("queued", "queued", "queued"),
      row("dispatching", "dispatching", "dispatching"),
      row("failed", "failed", "failed"),
    ]);
    expect(transcript).toEqual([{ role: "user", text: "settled" }]);
  });
});
