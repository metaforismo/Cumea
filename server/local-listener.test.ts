import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_PORT,
  DEFAULT_REMOTE_PORT,
  DEV_RENDERER_PORT,
  HARNESS_READY_KIND,
  HARNESS_READY_VERSION,
  harnessReadyMessage,
  localHostAllowed,
  localOriginAllowed,
  postHarnessReady,
  requestedLocalPort,
  requestedRemotePort,
  tcpPort,
} from "./local-listener.ts";

describe("local listener contract", () => {
  it("keeps the remote default independent from the local requested port", () => {
    expect(requestedLocalPort(undefined)).toBe(DEFAULT_LOCAL_PORT);
    expect(requestedLocalPort("0")).toBe(0);
    expect(requestedLocalPort("42123")).toBe(42123);
    expect(requestedRemotePort(undefined)).toBe(DEFAULT_REMOTE_PORT);
    expect(requestedRemotePort("42124")).toBe(42124);
  });

  it("rejects malformed local and remote ports", () => {
    for (const value of ["-1", "65536", "12.5", "abc"] ) {
      expect(() => requestedLocalPort(value)).toThrow();
    }
    for (const value of ["0", "-1", "65536", "12.5", "abc"] ) {
      expect(() => requestedRemotePort(value)).toThrow();
    }
  });

  it("extracts only a valid bound TCP port", () => {
    expect(tcpPort({ address: "127.0.0.1", family: "IPv4", port: 43123 })).toBe(43123);
    expect(() => tcpPort(null)).toThrow(/TCP address/);
    expect(() => tcpPort("pipe")).toThrow(/TCP address/);
  });

  it("accepts only numeric loopback or localhost Host values for the exact local port", () => {
    expect(localHostAllowed("127.0.0.1:43123", 43123)).toBe(true);
    expect(localHostAllowed("localhost:43123", 43123)).toBe(true);
    expect(localHostAllowed("LOCALHOST:43123", 43123)).toBe(true);
    expect(localHostAllowed("attacker.example:43123", 43123)).toBe(false);
    expect(localHostAllowed("127.0.0.1:43124", 43123)).toBe(false);
    expect(localHostAllowed(undefined, 43123)).toBe(false);
  });

  it("accepts the actual local origin and the explicit Vite dev origin only", () => {
    expect(localOriginAllowed("http://127.0.0.1:43123", 43123)).toBe(true);
    expect(localOriginAllowed("http://localhost:43123", 43123)).toBe(true);
    expect(localOriginAllowed(`http://127.0.0.1:${DEV_RENDERER_PORT}`, 43123)).toBe(true);
    expect(localOriginAllowed("https://127.0.0.1:43123", 43123)).toBe(false);
    expect(localOriginAllowed("http://attacker.example:43123", 43123)).toBe(false);
    expect(localOriginAllowed("http://127.0.0.1:43124", 43123)).toBe(false);
    expect(localOriginAllowed("http://127.0.0.1:43123/path", 43123)).toBe(false);
  });

  it("publishes one versioned readiness message to an Electron parent port", () => {
    const messages: unknown[] = [];
    const parentPort = { postMessage(message: unknown) { messages.push(message); } };
    expect(postHarnessReady(43123, parentPort)).toBe(true);
    expect(messages).toEqual([
      {
        kind: HARNESS_READY_KIND,
        version: HARNESS_READY_VERSION,
        pid: process.pid,
        port: 43123,
      },
    ]);
    expect(postHarnessReady(43123, null)).toBe(false);
    expect(harnessReadyMessage(43123, 99)).toEqual({
      kind: HARNESS_READY_KIND,
      version: HARNESS_READY_VERSION,
      pid: 99,
      port: 43123,
    });
  });
});
