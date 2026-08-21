import { describe, expect, it } from "vitest";

import {
  TRANSCRIPT_WINDOW_SIZE,
  expandWindowStart,
  focusWindowRange,
  resolveTranscriptWindow,
  tailWindowStart,
} from "./transcript-window";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("tailWindowStart", () => {
  it("keeps the last window worth of messages", () => {
    expect(tailWindowStart(1_000)).toBe(1_000 - TRANSCRIPT_WINDOW_SIZE);
  });

  it("clamps to zero on short threads", () => {
    expect(tailWindowStart(10)).toBe(0);
    expect(tailWindowStart(0)).toBe(0);
  });
});

describe("expandWindowStart", () => {
  it("steps back one window at a time", () => {
    expect(expandWindowStart(240)).toBe(240 - TRANSCRIPT_WINDOW_SIZE);
  });

  it("clamps at the top of the thread", () => {
    expect(expandWindowStart(50)).toBe(0);
    expect(expandWindowStart(0)).toBe(0);
  });
});

describe("focusWindowRange", () => {
  it("centers the target inside a bounded window", () => {
    const { start, end } = focusWindowRange(1_000, 500);
    expect(start).toBe(500 - Math.floor(TRANSCRIPT_WINDOW_SIZE / 2));
    expect(end - start).toBe(TRANSCRIPT_WINDOW_SIZE);
  });

  it("stays in bounds near both ends of the thread", () => {
    expect(focusWindowRange(1_000, 0).start).toBe(0);
    const last = focusWindowRange(1_000, 999);
    expect(last.end).toBe(1_000);
    expect(last.start).toBe(1_000 - TRANSCRIPT_WINDOW_SIZE);
  });

  it("handles empty and tiny lists without throwing", () => {
    expect(focusWindowRange(0, 3)).toEqual({ start: 0, end: 0 });
    expect(focusWindowRange(5, 99).end).toBe(5);
  });
});

describe("resolveTranscriptWindow", () => {
  it("mounts only the tail by default", () => {
    const result = resolveTranscriptWindow(range(300), tailWindowStart(300));
    expect(result.visible).toHaveLength(TRANSCRIPT_WINDOW_SIZE);
    expect(result.hiddenCount).toBe(300 - TRANSCRIPT_WINDOW_SIZE);
    expect(result.laterCount).toBe(0);
    expect(result.startIndex).toBe(300 - TRANSCRIPT_WINDOW_SIZE);
    expect(result.endIndex).toBe(300);
  });

  it("anchors the boundary so appends grow the window instead of sliding it", () => {
    const before = resolveTranscriptWindow(range(130), 10);
    expect(before.startIndex).toBe(10);
    const after = resolveTranscriptWindow(range(131), before.startIndex);
    expect(after.startIndex).toBe(10);
    expect(after.endIndex).toBe(131);
    expect(after.visible[0]).toBe(10);
  });

  it("falls back to a fresh tail when the stored boundary is past the end", () => {
    const result = resolveTranscriptWindow(range(40), 120);
    expect(result.startIndex).toBe(0);
    expect(result.visible).toHaveLength(40);
  });

  it("honors a finite search-focus window and reports later messages", () => {
    const { start, end } = focusWindowRange(1_000, 500);
    const result = resolveTranscriptWindow(range(1_000), start, TRANSCRIPT_WINDOW_SIZE, end);
    expect(result.visible[0]).toBe(start);
    expect(result.laterCount).toBe(1_000 - end);
  });

  it("discards an invalid finite window instead of blanking the transcript", () => {
    const result = resolveTranscriptWindow(range(80), 90, TRANSCRIPT_WINDOW_SIZE, 95);
    expect(result.startIndex).toBe(0);
    expect(result.visible).toHaveLength(80);
    expect(result.laterCount).toBe(0);
  });

  it("clamps a finite end beyond the list length", () => {
    const result = resolveTranscriptWindow(range(30), 0, TRANSCRIPT_WINDOW_SIZE, 500);
    expect(result.endIndex).toBe(30);
    expect(result.laterCount).toBe(0);
  });
});
