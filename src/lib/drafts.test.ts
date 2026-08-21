import { describe, expect, it } from "vitest";

import { parseComposerDrafts, readComposerDraft, updateComposerDrafts, writeComposerDraft } from "./drafts";

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    removeItem: () => { value = null; },
    value: () => value,
  };
}

describe("per-agent composer drafts", () => {
  it("keeps text isolated by bot and removes an emptied draft", () => {
    const store = storage();
    writeComposerDraft("bot-one", "first", store);
    writeComposerDraft("bot-two", "second", store);
    expect(readComposerDraft("bot-one", store)).toBe("first");
    expect(readComposerDraft("bot-two", store)).toBe("second");
    writeComposerDraft("bot-one", "", store);
    expect(readComposerDraft("bot-one", store)).toBe("");
    expect(readComposerDraft("bot-two", store)).toBe("second");
  });

  it("fails closed on malformed, invalid, and oversized stored values", () => {
    expect(parseComposerDrafts("not-json")).toEqual({});
    expect(parseComposerDrafts(JSON.stringify({ "../escape": "no", safe: 4 }))).toEqual({});
    const before = { safe: "draft" };
    expect(updateComposerDrafts(before, "../escape", "bad")).toBe(before);
    expect(updateComposerDrafts(before, "safe", "x".repeat(100_001))).toEqual({});
  });

  it("does not let storage errors interrupt the composer", () => {
    const broken = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(readComposerDraft("bot-one", broken)).toBe("");
    expect(() => writeComposerDraft("bot-one", "draft", broken)).not.toThrow();
  });
});
