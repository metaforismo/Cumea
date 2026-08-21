import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScreenActivityMonitor, SCREEN_POLL_INTERVAL_MS } from "./screen-activity.ts";

describe("createScreenActivityMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const frame = (n: number) => ({ png: `png-${n}`, format: "png" });

  function harness(overrides: Partial<{ configured: boolean; fail: boolean }> = {}) {
    const frames: Array<{ botId: string; png: string; mime: string }> = [];
    let n = 0;
    const monitor = createScreenActivityMonitor(
      {
        configured: () => overrides.configured ?? true,
        screenshot: async () => {
          if (overrides.fail) throw new Error("box asleep");
          return frame(++n);
        },
      },
      { onFrame: (f) => frames.push(f) },
    );
    return { monitor, frames };
  }

  it("does not poll when no box is configured", async () => {
    const { monitor, frames } = harness({ configured: false });
    monitor.start("bot");
    await vi.advanceTimersByTimeAsync(SCREEN_POLL_INTERVAL_MS * 3);
    expect(frames).toEqual([]);
    expect(monitor.peek("bot")).toBeNull();
  });

  it("captures on the interval and maps jpeg to the right mime", async () => {
    let n = 0;
    const frames: Array<{ png: string; mime: string }> = [];
    const monitor = createScreenActivityMonitor(
      {
        configured: () => true,
        screenshot: async () => (++n === 1 ? { png: "j1", format: "jpeg" } : { png: "p2", format: "png" }),
      },
      { onFrame: ({ png, mime }) => frames.push({ png, mime }) },
    );
    monitor.start("bot");
    await vi.advanceTimersByTimeAsync(SCREEN_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SCREEN_POLL_INTERVAL_MS);
    expect(frames).toEqual([
      { png: "j1", mime: "image/jpeg" },
      { png: "p2", mime: "image/png" },
    ]);
    expect(monitor.peek("bot")).toMatchObject({ png: "p2", capturedAt: expect.any(Number) });
  });

  it("keeps polling when a capture fails", async () => {
    let calls = 0;
    const frames: string[] = [];
    const monitor = createScreenActivityMonitor(
      {
        configured: () => true,
        screenshot: async () => {
          calls += 1;
          if (calls === 1) throw new Error("asleep");
          return { png: "ok", format: "png" };
        },
      },
      { onFrame: ({ png }) => frames.push(png) },
    );
    monitor.start("bot");
    await vi.advanceTimersByTimeAsync(SCREEN_POLL_INTERVAL_MS * 2);
    expect(frames).toEqual(["ok"]);
  });

  it("skips a capture while the previous one is still in flight", async () => {
    let calls = 0;
    let release: (() => void) | null = null;
    const monitor = createScreenActivityMonitor(
      {
        configured: () => true,
        screenshot: () =>
          new Promise((resolve) => {
            calls += 1;
            release = () => resolve({ png: "slow", format: "png" });
          }),
      },
      { onFrame: () => {} },
    );
    monitor.start("bot");
    await vi.advanceTimersByTimeAsync(SCREEN_POLL_INTERVAL_MS * 3);
    expect(calls).toBe(1);
    release!();
  });

  it("poke captures immediately without waiting for the interval", async () => {
    const { monitor, frames } = harness();
    monitor.start("bot");
    await vi.advanceTimersByTimeAsync(1);
    monitor.poke("bot");
    await vi.advanceTimersByTimeAsync(1);
    expect(frames).toHaveLength(1);
  });

  it("stop clears the interval, returns the last frame, and allows a restart", async () => {
    const { monitor, frames } = harness();
    monitor.start("bot");
    await vi.advanceTimersByTimeAsync(SCREEN_POLL_INTERVAL_MS);
    const last = monitor.stop("bot");
    expect(last).toMatchObject({ png: "png-1" });
    expect(monitor.peek("bot")).toBeNull();

    const before = frames.length;
    await vi.advanceTimersByTimeAsync(SCREEN_POLL_INTERVAL_MS * 2);
    expect(frames.length).toBe(before);

    monitor.start("bot");
    await vi.advanceTimersByTimeAsync(SCREEN_POLL_INTERVAL_MS);
    expect(frames.at(-1)).toMatchObject({ png: "png-2" });
  });

  it("stop of an unknown bot returns null", () => {
    const { monitor } = harness();
    expect(monitor.stop("ghost")).toBeNull();
  });
});
