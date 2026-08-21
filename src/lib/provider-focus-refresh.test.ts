import { describe, expect, it, vi } from "vitest";
import {
  installProviderFocusRefresh,
  PROVIDER_FOCUS_REFRESH_INTERVAL_MS,
} from "./provider-focus-refresh";

class FakeFocusTarget {
  private listeners = new Set<() => void>();

  addEventListener(type: "focus", listener: () => void) {
    if (type === "focus") this.listeners.add(listener);
  }

  removeEventListener(type: "focus", listener: () => void) {
    if (type === "focus") this.listeners.delete(listener);
  }

  focus() {
    for (const listener of this.listeners) listener();
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("provider focus refresh", () => {
  it("refreshes on the first focus", async () => {
    const target = new FakeFocusTarget();
    const refresh = vi.fn().mockResolvedValue(undefined);
    installProviderFocusRefresh({ target, refresh, now: () => 0 });

    target.focus();
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("throttles focus events until the monotonic window has elapsed", async () => {
    const target = new FakeFocusTarget();
    const refresh = vi.fn().mockResolvedValue(undefined);
    let clock = 10;
    installProviderFocusRefresh({ target, refresh, now: () => clock });

    target.focus();
    await settle();
    clock += PROVIDER_FOCUS_REFRESH_INTERVAL_MS - 1;
    target.focus();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);

    clock += 1;
    target.focus();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("deduplicates a refresh that is already in flight", async () => {
    const target = new FakeFocusTarget();
    const request = deferred();
    const refresh = vi.fn(() => request.promise);
    let clock = 0;
    installProviderFocusRefresh({ target, refresh, now: () => clock });

    target.focus();
    clock = PROVIDER_FOCUS_REFRESH_INTERVAL_MS;
    target.focus();
    expect(refresh).toHaveBeenCalledTimes(1);

    request.resolve();
    await settle();
    target.focus();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("removes the focus listener during cleanup", () => {
    const target = new FakeFocusTarget();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const cleanup = installProviderFocusRefresh({ target, refresh, now: () => 0 });

    cleanup();
    target.focus();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the available snapshot after a rejected background refresh", async () => {
    const target = new FakeFocusTarget();
    const availableSnapshot = [{ instanceId: "codex", state: "available" }];
    let currentSnapshot = availableSnapshot;
    const refresh = vi.fn(async () => {
      const nextSnapshot = await Promise.reject<typeof availableSnapshot>(
        new Error("provider temporarily unavailable"),
      );
      currentSnapshot = nextSnapshot;
    });
    installProviderFocusRefresh({ target, refresh, now: () => 0 });

    target.focus();
    await settle();
    target.focus();
    await settle();

    expect(currentSnapshot).toBe(availableSnapshot);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
