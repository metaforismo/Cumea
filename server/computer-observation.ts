import { createHash } from "node:crypto";

export interface ObservationMetrics {
  screenshotsCaptured: number;
  screenshotsSentToModel: number;
  structuredBrowserObservations: number;
  computerActions: number;
  retries: number;
  verificationSuccesses: number;
  verificationFailures: number;
}

export interface BrowserTarget {
  id: string;
  title: string;
  /** Safe for model/tool output: credentials, query and fragment removed. */
  url: string;
  /** Internal-only navigation comparison value. */
  comparisonUrl: string;
}

export function normalizeBrowserUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 8_192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function safeBrowserUrl(value: unknown): string | null {
  const normalized = normalizeBrowserUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  url.search = "";
  url.hash = "";
  const safe = url.toString();
  return safe.length <= 2_048 ? safe : null;
}

export function parseBrowserTargets(raw: string): BrowserTarget[] {
  if (raw.length > 1_000_000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const comparisonUrl = normalizeBrowserUrl(value.url);
      const url = safeBrowserUrl(value.url);
      if (value.type !== "page" || typeof value.id !== "string" || !url || !comparisonUrl) return [];
      const title = typeof value.title === "string"
        ? value.title.replace(/\s+/g, " ").trim().slice(0, 200)
        : "";
      return [{ id: value.id.slice(0, 100), title, url, comparisonUrl }];
    });
  } catch {
    return [];
  }
}

export class ObservationCoordinator {
  readonly metrics: ObservationMetrics = {
    screenshotsCaptured: 0,
    screenshotsSentToModel: 0,
    structuredBrowserObservations: 0,
    computerActions: 0,
    retries: 0,
    verificationSuccesses: 0,
    verificationFailures: 0,
  };
  private lastFrameHash: string | null = null;

  noteAction(count = 1) {
    this.metrics.computerActions += Math.max(0, Math.trunc(count));
  }

  noteRetry() {
    this.metrics.retries += 1;
  }

  observeFrame(frame: string | null) {
    this.metrics.screenshotsCaptured += 1;
    const hash = frame ? createHash("sha256").update(frame).digest("hex") : null;
    const changed = hash === null || hash !== this.lastFrameHash;
    if (hash) this.lastFrameHash = hash;
    if (changed) this.metrics.screenshotsSentToModel += 1;
    return { changed, hash };
  }

  noteStructuredObservation() {
    this.metrics.structuredBrowserObservations += 1;
  }

  noteVerification(ok: boolean) {
    if (ok) this.metrics.verificationSuccesses += 1;
    else this.metrics.verificationFailures += 1;
  }
}
