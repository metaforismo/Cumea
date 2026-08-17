import { describe, expect, it } from "vitest";

import { startupApi } from "./startup-api";

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("startupApi", () => {
  it("retries only signed starting states and returns the first success", async () => {
    const responses = [
      jsonResponse(
        503,
        { error: "agent host is starting" },
        { "x-cumea-desktop-state": "starting" },
      ),
      jsonResponse(
        503,
        { error: "agent host is restarting" },
        { "x-cumea-desktop-state": "restarting" },
      ),
      jsonResponse(200, { ok: true }),
    ];
    let calls = 0;
    let clock = 0;
    const result = await startupApi<{ ok: boolean }>(
      "/api/config",
      {},
      {
        timeoutMs: 1_000,
        retryMs: 25,
        fetchImpl: async () => responses[calls++]!,
        now: () => clock,
        sleepImpl: async (ms) => {
          clock += ms;
        },
      },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("does not retry a same-text harness 503 without the gateway state header", async () => {
    let calls = 0;
    await expect(
      startupApi(
        "/api/config",
        {},
        {
          fetchImpl: async () => {
            calls += 1;
            return jsonResponse(503, { error: "agent host is starting" });
          },
          sleepImpl: async () => {
            throw new Error("must not sleep");
          },
        },
      ),
    ).rejects.toThrow("agent host is starting");
    expect(calls).toBe(1);
  });

  it("requires the signed state and public error text to agree", async () => {
    let calls = 0;
    await expect(
      startupApi(
        "/api/config",
        {},
        {
          fetchImpl: async () => {
            calls += 1;
            return jsonResponse(
              503,
              { error: "agent host is restarting" },
              { "x-cumea-desktop-state": "starting" },
            );
          },
          sleepImpl: async () => {
            throw new Error("must not sleep");
          },
        },
      ),
    ).rejects.toThrow("agent host is restarting");
    expect(calls).toBe(1);
  });

  it("never retries a signed non-idempotent POST", async () => {
    let calls = 0;
    await expect(
      startupApi(
        "/api/create",
        { method: "POST" },
        {
          fetchImpl: async () => {
            calls += 1;
            return jsonResponse(
              503,
              { error: "agent host is starting" },
              { "x-cumea-desktop-state": "starting" },
            );
          },
          sleepImpl: async () => {
            throw new Error("must not sleep");
          },
        },
      ),
    ).rejects.toThrow("agent host is starting");
    expect(calls).toBe(1);
  });

  it("does not retry the terminal harness failure state", async () => {
    let calls = 0;
    await expect(
      startupApi(
        "/api/config",
        {},
        {
          fetchImpl: async () => {
            calls += 1;
            return jsonResponse(
              503,
              { error: "agent host could not start" },
              { "x-cumea-desktop-state": "failed" },
            );
          },
          now: () => 0,
          sleepImpl: async () => {
            throw new Error("must not sleep");
          },
        },
      ),
    ).rejects.toThrow("agent host could not start");
    expect(calls).toBe(1);
  });

  it("does not hide application validation failures", async () => {
    let calls = 0;
    await expect(
      startupApi(
        "/api/config",
        {},
        {
          fetchImpl: async () => {
            calls += 1;
            return jsonResponse(400, { error: "invalid profile" });
          },
        },
      ),
    ).rejects.toThrow("invalid profile");
    expect(calls).toBe(1);
  });

  it("stops retrying once its bounded startup window expires", async () => {
    let calls = 0;
    let clock = 0;
    await expect(
      startupApi(
        "/api/config",
        {},
        {
          timeoutMs: 40,
          retryMs: 20,
          fetchImpl: async () => {
            calls += 1;
            return jsonResponse(
              503,
              { error: "agent host is starting" },
              { "x-cumea-desktop-state": "starting" },
            );
          },
          now: () => clock,
          sleepImpl: async (ms) => {
            clock += ms;
          },
        },
      ),
    ).rejects.toThrow("agent host is starting");
    expect(calls).toBe(3);
  });

  it("respects an already-aborted caller", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      startupApi(
        "/api/config",
        { signal: controller.signal },
        { fetchImpl: async () => jsonResponse(200, {}) },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
