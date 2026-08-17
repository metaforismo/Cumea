const RETRYABLE_STARTUP_ERRORS = new Set([
  "agent host is starting",
  "agent host is restarting",
]);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_MS = 250;

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorMessage(payload: unknown, status: number): string {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return `request failed (${status})`;
}

function abortError(): Error {
  return Object.assign(new Error("request aborted"), { name: "AbortError" });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface StartupApiOptions {
  timeoutMs?: number;
  retryMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * API helper for the one period in which the packaged desktop shell exists
 * before its harness. It retries only the gateway's explicit starting /
 * restarting states. Provider errors, validation errors, authentication
 * failures, and the terminal "could not start" state fail immediately.
 */
export async function startupApi<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: StartupApiOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 120_000) {
    throw new Error("invalid startup API timeout");
  }
  if (!Number.isFinite(retryMs) || retryMs < 10 || retryMs > 5_000) {
    throw new Error("invalid startup API retry interval");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  const sleepImpl = options.sleepImpl ?? sleep;
  const deadline = now() + timeoutMs;

  for (;;) {
    if (init.signal?.aborted) throw abortError();
    const response = await fetchImpl(input, init);
    const text = await response.text();
    const payload = parseJson(text);
    if (response.ok) return payload as T;

    const message = errorMessage(payload, response.status);
    const retryable = response.status === 503 && RETRYABLE_STARTUP_ERRORS.has(message);
    if (!retryable || now() >= deadline) throw new Error(message);
    await sleepImpl(retryMs, init.signal ?? undefined);
  }
}
