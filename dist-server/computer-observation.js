import { createHash } from "node:crypto";
export function normalizeBrowserUrl(value) {
    if (typeof value !== "string" || !value || value.length > 8_192)
        return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:")
            return null;
        url.username = "";
        url.password = "";
        return url.toString();
    }
    catch {
        return null;
    }
}
export function safeBrowserUrl(value) {
    const normalized = normalizeBrowserUrl(value);
    if (!normalized)
        return null;
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    const safe = url.toString();
    return safe.length <= 2_048 ? safe : null;
}
export function parseBrowserTargets(raw) {
    if (raw.length > 1_000_000)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.slice(0, 20).flatMap((item) => {
            if (!item || typeof item !== "object")
                return [];
            const value = item;
            const comparisonUrl = normalizeBrowserUrl(value.url);
            const url = safeBrowserUrl(value.url);
            if (value.type !== "page" || typeof value.id !== "string" || !url || !comparisonUrl)
                return [];
            const title = typeof value.title === "string"
                ? value.title.replace(/\s+/g, " ").trim().slice(0, 200)
                : "";
            return [{ id: value.id.slice(0, 100), title, url, comparisonUrl }];
        });
    }
    catch {
        return [];
    }
}
export class ObservationCoordinator {
    metrics = {
        screenshotsCaptured: 0,
        screenshotsSentToModel: 0,
        structuredBrowserObservations: 0,
        computerActions: 0,
        retries: 0,
        verificationSuccesses: 0,
        verificationFailures: 0,
    };
    lastFrameHash = null;
    noteAction(count = 1) {
        this.metrics.computerActions += Math.max(0, Math.trunc(count));
    }
    noteRetry() {
        this.metrics.retries += 1;
    }
    observeFrame(frame) {
        this.metrics.screenshotsCaptured += 1;
        const hash = frame ? createHash("sha256").update(frame).digest("hex") : null;
        const changed = hash === null || hash !== this.lastFrameHash;
        if (hash)
            this.lastFrameHash = hash;
        if (changed)
            this.metrics.screenshotsSentToModel += 1;
        return { changed, hash };
    }
    noteStructuredObservation() {
        this.metrics.structuredBrowserObservations += 1;
    }
    noteVerification(ok) {
        if (ok)
            this.metrics.verificationSuccesses += 1;
        else
            this.metrics.verificationFailures += 1;
    }
}
