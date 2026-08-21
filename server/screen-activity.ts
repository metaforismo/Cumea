// Live screen: poll the bot's box while it works. Frames stream to clients
// as SSE {kind:'screen'} (the "Bot's screen" panel); the final frame is
// folded into the transcript on turn end.
export type ScreenFrame = { png: string; mime: string; capturedAt: number };

export interface ScreenActivitySource {
  /** Whether any box is configured at all — gates poller creation. */
  configured(): boolean;
  /** Capture one frame of the given bot's box. May reject (box asleep). */
  screenshot(botId: string): Promise<{ png: string; format: string }>;
}

export interface ScreenActivityHooks {
  /** Fan one fresh frame out to connected clients. */
  onFrame(frame: ScreenFrame & { botId: string }): void;
}

export const SCREEN_POLL_INTERVAL_MS = 4000;

export interface ScreenActivityMonitor {
  start(botId: string): void;
  /** Event-driven refresh: capture NOW (the bot just acted on its screen)
   * instead of waiting for the next interval tick. */
  poke(botId: string): void;
  /** Stop polling and return the last captured frame, if any. */
  stop(botId: string): ScreenFrame | null;
  /** Read the last captured frame without stopping the poller. */
  peek(botId: string): ScreenFrame | null;
}

export function createScreenActivityMonitor(source: ScreenActivitySource, hooks: ScreenActivityHooks): ScreenActivityMonitor {
  const pollers = new Map<
    string,
    { timer: ReturnType<typeof setInterval>; capture: () => Promise<void>; last: ScreenFrame | null }
  >();

  function start(botId: string) {
    if (pollers.has(botId) || !source.configured()) return;
    let inFlight = false;
    const capture = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { png, format } = await source.screenshot(botId);
        const frame = { png, mime: format === "jpeg" ? "image/jpeg" : "image/png", capturedAt: Date.now() };
        entry.last = frame;
        hooks.onFrame({ botId, ...frame });
      } catch {
        /* box asleep or mid-command — try again next tick */
      } finally {
        inFlight = false;
      }
    };
    const entry = {
      timer: setInterval(capture, SCREEN_POLL_INTERVAL_MS),
      capture,
      last: null as ScreenFrame | null,
    };
    pollers.set(botId, entry);
  }

  function poke(botId: string) {
    void pollers.get(botId)?.capture();
  }

  function stop(botId: string): ScreenFrame | null {
    const entry = pollers.get(botId);
    if (!entry) return null;
    clearInterval(entry.timer);
    pollers.delete(botId);
    return entry.last;
  }

  function peek(botId: string): ScreenFrame | null {
    return pollers.get(botId)?.last ?? null;
  }

  return { start, poke, stop, peek };
}
