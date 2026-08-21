/**
 * Synchronous reservation gate for approval answers. The persisted card's
 * `answered` flag is patched asynchronously by the event folder, so two
 * concurrent /respond calls can both read "pending" from the store; the
 * gate reserves each request key before the provider round-trip so exactly
 * one answer wins. A failed provider call releases its key so the answer
 * can be retried; a settled one retires it for good.
 */
export interface AnswerGate {
  reserve(key: string): boolean;
  /** A failed answer — allow a retry. */
  release(key: string): void;
  /** A settled answer — retire the key. */
  settle(key: string): void;
}

export function createAnswerGate(): AnswerGate {
  const live = new Set<string>();
  return {
    reserve(key) {
      if (live.has(key)) return false;
      live.add(key);
      return true;
    },
    release(key) {
      live.delete(key);
    },
    settle(key) {
      live.delete(key);
    },
  };
}
