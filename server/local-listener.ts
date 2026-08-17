import type { AddressInfo } from "node:net";

export const DEFAULT_LOCAL_PORT = 8799;
export const DEFAULT_REMOTE_PORT = 8800;
export const DEV_RENDERER_PORT = 5199;
export const HARNESS_READY_KIND = "cumea:harness-ready" as const;
export const HARNESS_READY_VERSION = 1 as const;

interface ParentPortLike {
  postMessage(message: unknown): void;
}

export interface HarnessReadyMessage {
  kind: typeof HARNESS_READY_KIND;
  version: typeof HARNESS_READY_VERSION;
  pid: number;
  port: number;
}

function parsePort(raw: string | undefined, fallback: number, allowZero: boolean, label: string): number {
  const source = raw === undefined || raw.trim() === "" ? String(fallback) : raw.trim();
  if (!/^\d+$/.test(source)) throw new Error(`${label} must be an integer`);
  const port = Number(source);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(port) || port < minimum || port > 65_535) {
    throw new Error(`${label} must be between ${minimum} and 65535`);
  }
  return port;
}

export function requestedLocalPort(raw = process.env.CUMEA_PORT): number {
  return parsePort(raw, DEFAULT_LOCAL_PORT, true, "CUMEA_PORT");
}

export function requestedRemotePort(raw = process.env.CUMEA_REMOTE_PORT): number {
  return parsePort(raw, DEFAULT_REMOTE_PORT, false, "CUMEA_REMOTE_PORT");
}

export function tcpPort(address: string | AddressInfo | null): number {
  if (!address || typeof address === "string") throw new Error("listener did not expose a TCP address");
  if (!Number.isInteger(address.port) || address.port < 1 || address.port > 65_535) {
    throw new Error("listener exposed an invalid TCP port");
  }
  return address.port;
}

export function localHostAllowed(hostHeader: string | undefined, localPort: number): boolean {
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) return false;
  if (!hostHeader) return false;
  const expected = new Set([
    `127.0.0.1:${localPort}`,
    `localhost:${localPort}`,
    ...(localPort === 80 ? ["127.0.0.1", "localhost"] : []),
  ]);
  return expected.has(hostHeader.toLowerCase());
}

export function localOriginAllowed(
  rawOrigin: string,
  localPort: number,
  devPort = DEV_RENDERER_PORT,
): boolean {
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) return false;
  try {
    const origin = new URL(rawOrigin);
    if (origin.protocol !== "http:") return false;
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
      return false;
    }
    if (origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost") return false;
    const port = Number(origin.port || (origin.protocol === "http:" ? 80 : 443));
    return port === localPort || port === devPort;
  } catch {
    return false;
  }
}

export function harnessReadyMessage(
  port: number,
  pid = process.pid,
): HarnessReadyMessage {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("harness PID is invalid");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("harness port is invalid");
  }
  return {
    kind: HARNESS_READY_KIND,
    version: HARNESS_READY_VERSION,
    pid,
    port,
  };
}

export function postHarnessReady(
  port: number,
  parentPort = (process as typeof process & { parentPort?: ParentPortLike | null }).parentPort,
): boolean {
  if (!parentPort) return false;
  parentPort.postMessage(harnessReadyMessage(port));
  return true;
}
