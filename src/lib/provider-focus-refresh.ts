export const PROVIDER_FOCUS_REFRESH_INTERVAL_MS = 30_000;

interface FocusEventTarget {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
}

interface ProviderFocusRefreshOptions {
  target: FocusEventTarget;
  refresh: () => Promise<unknown>;
  now?: () => number;
  intervalMs?: number;
}

/**
 * Re-probe the existing provider inventory when the desktop/web renderer comes
 * back into focus. Refresh failures are deliberately quiet: callers keep their
 * last successful snapshot and the next focus after the throttle window retries.
 */
export function installProviderFocusRefresh({
  target,
  refresh,
  now = () => performance.now(),
  intervalMs = PROVIDER_FOCUS_REFRESH_INTERVAL_MS,
}: ProviderFocusRefreshOptions): () => void {
  let lastAttemptAt: number | undefined;
  let inFlight: Promise<void> | undefined;

  const onFocus = () => {
    if (inFlight) return;

    const focusedAt = now();
    if (lastAttemptAt !== undefined && focusedAt - lastAttemptAt < intervalMs) return;
    lastAttemptAt = focusedAt;

    const pending = (async () => {
      try {
        await refresh();
      } catch {
        // A background re-probe must not clear the last snapshot or create a
        // repeating error surface. A later focus can retry after the interval.
      }
    })();
    inFlight = pending;
    void pending.finally(() => {
      if (inFlight === pending) inFlight = undefined;
    });
  };

  target.addEventListener("focus", onFocus);
  return () => target.removeEventListener("focus", onFocus);
}
