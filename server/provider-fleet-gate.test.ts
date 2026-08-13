import { describe, expect, it } from "vitest";

import { ProviderFleetGate } from "./provider-fleet-gate.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("provider fleet generation", () => {
  it("invalidates turn snapshots synchronously before a reload can await", async () => {
    const gate = new ProviderFleetGate();
    const turn = gate.snapshot();
    const held = deferred();
    const reload = gate.reload(async () => held.promise);
    expect(turn.isCurrent()).toBe(false);
    expect(gate.snapshot().isCurrent()).toBe(false);
    held.resolve();
    await reload;
    expect(gate.snapshot().isCurrent()).toBe(true);
  });

  it("serializes concurrent reloads and only attaches the newest fleet", async () => {
    const gate = new ProviderFleetGate();
    const firstHeld = deferred();
    const firstEntered = deferred();
    const events: string[] = [];
    let activeReloads = 0;
    let maxActiveReloads = 0;

    const first = gate.reload(async (lease) => {
      activeReloads += 1;
      maxActiveReloads = Math.max(maxActiveReloads, activeReloads);
      events.push("first-created");
      firstEntered.resolve();
      await firstHeld.promise;
      if (lease.isLatest()) events.push("first-attached");
      else events.push("first-disposed-stale");
      activeReloads -= 1;
    });
    await firstEntered.promise;
    const second = gate.reload(async (lease) => {
      activeReloads += 1;
      maxActiveReloads = Math.max(maxActiveReloads, activeReloads);
      events.push("second-created");
      if (lease.isLatest()) events.push("second-attached");
      activeReloads -= 1;
    });
    firstHeld.resolve();
    await Promise.all([first, second]);

    expect(maxActiveReloads).toBe(1);
    expect(events).toEqual([
      "first-created",
      "first-disposed-stale",
      "second-created",
      "second-attached",
    ]);
  });

  it("forces a stale post-send result to interrupt without commit", async () => {
    const gate = new ProviderFleetGate();
    const turnFleet = gate.snapshot();
    const sent = deferred();
    const reloadHeld = deferred();
    let interrupted = false;
    let bound = false;
    let persisted = false;
    const dispatch = (async () => {
      await sent.promise;
      if (!turnFleet.isCurrent()) {
        interrupted = true;
        return;
      }
      bound = true;
      persisted = true;
    })();
    const reload = gate.reload(async () => reloadHeld.promise);
    sent.resolve();
    await dispatch;
    expect({ interrupted, bound, persisted }).toEqual({ interrupted: true, bound: false, persisted: false });
    reloadHeld.resolve();
    await reload;
  });
});
