import { afterEach, describe, expect, it, vi } from "vitest";

import { provisionBox } from "./box.ts";

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Box provisioning", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries at the two-hour ceiling for free-trial accounts", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const replies = [
      response(200, { boxes: [] }),
      response(400, {
        code: "trial_auto_stop_required",
        message: "Free-trial Boxes can auto-stop after at most 2 hours.",
      }),
      response(201, { box: { id: "box-1", state: "idle" } }),
      response(200, { ok: true }),
      response(200, { box: { id: "box-1", state: "idle" } }),
      response(200, { exitCode: 0, stdout: "bootstrapped", stderr: "" }),
      response(200, { desktopUrl: "https://desktop.example/box-1" }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const next = replies.shift();
      if (!next) throw new Error(`unexpected fetch: ${url}`);
      return next;
    }));

    const result = await provisionBox(
      { box: { token: "test-token" } },
      "bot-trial",
      "Trial helper",
    );

    const creates = calls.filter((call) => call.url.endsWith("/boxes") && call.init?.method === "POST");
    expect(creates).toHaveLength(2);
    expect(JSON.parse(String(creates[0].init?.body))).toEqual({ ttlSeconds: 8 * 60 * 60 });
    expect(JSON.parse(String(creates[1].init?.body))).toEqual({ ttlSeconds: 2 * 60 * 60 });
    expect(result).toMatchObject({ boxId: "box-1", reused: false, state: "idle" });
  });
});
