const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Open only web URLs. Plain HTTP is limited to loopback development URLs. */
export function openExternalUrl(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
      return false;
    }
    const opened = window.open(url.toString(), "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
    return Boolean(opened) || navigator.userAgent.includes("Electron");
  } catch {
    return false;
  }
}
