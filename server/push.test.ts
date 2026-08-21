import { describe, expect, it, vi } from "vitest";
import { checkExpoPushReceipts, sendExpoPush } from "./push.ts";

describe("Expo push projection", () => {
  it("sends only the minimal bounded payload and maps receipts to tokens", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body));
      expect(messages).toEqual([{
        to: "ExpoPushToken[abcdefghijklmnop]",
        title: "Researcher",
        body: "Finished working",
        data: { kind: "completed", botId: "bot-1" },
        sound: "default",
        priority: "high",
      }]);
      expect(JSON.stringify(messages)).not.toMatch(/prompt|response|model|tokenHash|computer/i);
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "receipt-1" }] }), { status: 200 });
    });
    const result = await sendExpoPush(
      [{ deviceId: "device-1", token: "ExpoPushToken[abcdefghijklmnop]" }],
      { title: "Researcher", body: "Finished working", data: { kind: "completed", botId: "bot-1" } },
      { fetcher: fetcher as typeof fetch },
    );
    expect(result).toEqual({
      staleTokens: [],
      receipts: [{ id: "receipt-1", token: "ExpoPushToken[abcdefghijklmnop]" }],
    });
  });

  it("removes devices reported unregistered by tickets or receipts", async () => {
    const sendFetcher = vi.fn(async () => new Response(JSON.stringify({
      data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
    }), { status: 200 }));
    const sent = await sendExpoPush(
      [{ deviceId: "device-1", token: "ExpoPushToken[abcdefghijklmnop]" }],
      { title: "Cumea", body: "Needs your attention", data: { kind: "needs_attention", botId: "bot-1" } },
      { fetcher: sendFetcher as typeof fetch },
    );
    expect(sent.staleTokens).toEqual(["ExpoPushToken[abcdefghijklmnop]"]);

    const receiptFetcher = vi.fn(async () => new Response(JSON.stringify({
      data: { "receipt-1": { status: "error", details: { error: "DeviceNotRegistered" } } },
    }), { status: 200 }));
    await expect(checkExpoPushReceipts(
      [{ id: "receipt-1", token: "ExpoPushToken[abcdefghijklmnop]" }],
      { fetcher: receiptFetcher as typeof fetch },
    )).resolves.toEqual(["ExpoPushToken[abcdefghijklmnop]"]);
  });
});
