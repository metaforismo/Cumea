import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  archiveBoxByIdForDeletion,
  archiveBoxForBotDeletion,
  boxStatus,
  provisionBox,
  readWorkspaceFile,
  resumeBoxAfterDeletionRollback,
  screenshotBox,
} from "./box.ts";

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

  it("shares one provisioning flight for concurrent callers of the same bot", async () => {
    let releaseList!: () => void;
    const listHeld = new Promise<void>((resolve) => { releaseList = resolve; });
    const replies = [
      response(201, { box: { id: "box-single", state: "idle" } }),
      response(200, { ok: true }),
      response(200, { box: { id: "box-single", state: "idle" } }),
      response(200, { exitCode: 0, stdout: "bootstrapped", stderr: "" }),
      response(200, { desktopUrl: "https://desktop.example/box-single" }),
    ];
    let listCalls = 0;
    let createCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/boxes") && !init?.method) {
        listCalls += 1;
        await listHeld;
        return response(200, { boxes: [] });
      }
      if (String(url).endsWith("/boxes") && init?.method === "POST") createCalls += 1;
      const next = replies.shift();
      if (!next) throw new Error(`unexpected fetch: ${url}`);
      return next;
    }));

    const first = provisionBox({ box: { token: "test-token" } }, "bot-single", "Single");
    const second = provisionBox({ box: { token: "test-token" } }, "bot-single", "Single");
    releaseList();
    const [one, two] = await Promise.all([first, second]);
    expect(one).toEqual(two);
    expect(listCalls).toBe(1);
    expect(createCalls).toBe(1);
  });

  it("keeps a flight on its captured token and separates a hot-reloaded credential", async () => {
    const cfg = { box: { token: "old-token" } };
    let releaseOldList!: () => void;
    let oldListEntered!: () => void;
    const oldListHeld = new Promise<void>((resolve) => { releaseOldList = resolve; });
    const oldListStarted = new Promise<void>((resolve) => { oldListEntered = resolve; });
    const authCalls: string[] = [];
    let creates = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      authCalls.push(auth);
      const suffix = auth === "Bearer old-token" ? "old" : "new";
      if (target.endsWith("/boxes") && !init?.method) {
        if (suffix === "old") {
          oldListEntered();
          await oldListHeld;
        }
        return response(200, { boxes: [] });
      }
      if (target.endsWith("/boxes") && init?.method === "POST") {
        creates += 1;
        return response(201, { box: { id: `box-${suffix}`, state: "idle" } });
      }
      if (target.endsWith(`/boxes/box-${suffix}`) && init?.method === "PATCH") return response(200, { ok: true });
      if (target.endsWith(`/boxes/box-${suffix}`) && !init?.method) {
        return response(200, { box: { id: `box-${suffix}`, state: "idle" } });
      }
      if (target.endsWith(`/boxes/box-${suffix}/commands`)) {
        return response(200, { exitCode: 0, stdout: "bootstrapped", stderr: "" });
      }
      if (target.endsWith(`/boxes/box-${suffix}/desktop?vnc=1`)) {
        return response(200, { desktopUrl: `https://desktop.example/box-${suffix}` });
      }
      throw new Error(`unexpected fetch: ${target}`);
    }));

    const oldFlight = provisionBox(cfg, "bot-token", "Token bot");
    await oldListStarted;
    cfg.box.token = "new-token";
    const newFlight = provisionBox(cfg, "bot-token", "Token bot");
    const newResult = await newFlight;
    releaseOldList();
    const oldResult = await oldFlight;

    expect(oldResult.boxId).toBe("box-old");
    expect(newResult.boxId).toBe("box-new");
    expect(creates).toBe(2);
    expect(authCalls.filter((auth) => auth === "Bearer old-token")).toHaveLength(6);
    expect(authCalls.filter((auth) => auth === "Bearer new-token")).toHaveLength(6);
    expect(authCalls.every((auth) => auth === "Bearer old-token" || auth === "Bearer new-token")).toBe(true);
  });

  it("snapshots a bounded /workspace file without interpolating its path into shell source", async () => {
    const source = Buffer.from("# Cloud report");
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bot-cloud"))).toString("hex");
    const boxName = `cumea-botclou-${digest.slice(0, 6)}`;
    let snapshotCommand = "";
    let snapshotPath = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/boxes")) {
        return response(200, { boxes: [{ id: "box-1", name: boxName, state: "idle" }] });
      }
      if (target.endsWith("/boxes/box-1/commands")) {
        const command = String(JSON.parse(String(init?.body)).command);
        if (command.startsWith("rm -f")) return response(200, { exitCode: 0, stdout: "", stderr: "" });
        snapshotCommand = command;
        const encoded = command.match(/printf %s ([A-Za-z0-9+/=]+) \|/)?.[1];
        const script = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
        snapshotPath = script.match(/\/tmp\/cumea-preview-[a-f0-9]+\.bin/)?.[0] ?? "";
        return response(200, {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            path: snapshotPath,
            size: source.length,
            name: "report;$(touch hacked).md",
            sha256: createHash("sha256").update(source).digest("hex"),
          }),
          stderr: "",
        });
      }
      if (target.includes("/boxes/box-1/files?")) {
        expect(decodeURIComponent(target)).toContain(snapshotPath);
        return response(200, { ok: true, content: source.toString("base64") });
      }
      throw new Error(`unexpected fetch: ${target}`);
    }));

    const result = await readWorkspaceFile(
      { box: { token: "test-token" } },
      "bot-cloud",
      "/workspace/report;$(touch hacked).md",
    );
    expect(result.bytes).toEqual(source);
    expect(result).toMatchObject({ name: "report;$(touch hacked).md", source: "cloud" });
    expect(snapshotCommand).not.toContain("report;$(touch hacked).md");
  });

  it("rejects a cloud path outside /workspace before any network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(readWorkspaceFile({ box: { token: "test-token" } }, "bot-cloud", "/etc/passwd.pdf"))
      .rejects.toThrow(/outside/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cleans the VM snapshot even when its metadata response is malformed", async () => {
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bot-cloud"))).toString("hex");
    const boxName = `cumea-botclou-${digest.slice(0, 6)}`;
    let cleanupRan = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/boxes")) return response(200, { boxes: [{ id: "box-1", name: boxName, state: "idle" }] });
      if (target.endsWith("/boxes/box-1/commands")) {
        const command = String(JSON.parse(String(init?.body)).command);
        if (command.startsWith("rm -f")) {
          cleanupRan = true;
          return response(200, { exitCode: 0, stdout: "", stderr: "" });
        }
        return response(200, { exitCode: 0, stdout: "not-json", stderr: "" });
      }
      throw new Error(`unexpected fetch: ${target}`);
    }));

    await expect(readWorkspaceFile({ box: { token: "test-token" } }, "bot-cloud", "/workspace/report.md"))
      .rejects.toThrow(/invalid file metadata/i);
    expect(cleanupRan).toBe(true);
  });
});

describe("Box deletion cleanup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests /stop when the bot owns a Box", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bot-delete"))).toString("hex");
    const boxName = `cumea-botdele-${digest.slice(0, 6)}`;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/boxes")) {
        return response(200, { boxes: [{ id: "box-delete-1", name: boxName, state: "running" }] });
      }
      if (String(url).endsWith("/boxes/box-delete-1/stop")) return response(200, { ok: true });
      throw new Error(`unexpected fetch: ${url}`);
    }));

    await expect(archiveBoxForBotDeletion({ box: { token: "test-token" } }, "bot-delete"))
      .resolves.toEqual({ outcome: "stop-requested" });
    expect(calls).toEqual([
      expect.objectContaining({ url: expect.stringMatching(/\/boxes$/) }),
      expect.objectContaining({
        url: expect.stringMatching(/\/boxes\/box-delete-1\/stop$/),
        init: expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
      }),
    ]);
  });

  it("stops the exact late-provisioned Box id without an owner lookup", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toMatch(/\/boxes\/box-late%2Fexact\/stop$/);
      expect(init).toMatchObject({ method: "POST", signal: expect.any(AbortSignal) });
      return response(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(archiveBoxByIdForDeletion(
      { box: { token: "test-token" } },
      "box-late/exact",
    )).resolves.toEqual({ outcome: "stop-requested" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the bot has no Box", async () => {
    const fetchMock = vi.fn(async () => response(200, { boxes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(archiveBoxForBotDeletion({ box: { token: "test-token" } }, "bot-without-box"))
      .resolves.toEqual({ outcome: "not-found" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an explicit warning without throwing when /stop fails", async () => {
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bot-delete"))).toString("hex");
    const boxName = `cumea-botdele-${digest.slice(0, 6)}`;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/boxes")) {
        return response(200, { boxes: [{ id: "box-delete-1", name: boxName, state: "running" }] });
      }
      return response(503, { error: "offline" });
    }));

    await expect(archiveBoxForBotDeletion({ box: { token: "test-token" } }, "bot-delete"))
      .resolves.toEqual({
        outcome: "warning",
        warning: expect.stringMatching(/provider-side TTL remains the cleanup backstop/i),
      });
  });

  it("turns a deterministic abort into a warning instead of blocking deletion", async () => {
    const aborted = AbortSignal.abort(new DOMException("deadline", "TimeoutError"));
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      throw new Error("the cleanup request was not bounded");
    }));

    await expect(archiveBoxForBotDeletion(
      { box: { token: "test-token" } },
      "bot-timeout",
      { signal: aborted },
    )).resolves.toEqual({
      outcome: "warning",
      warning: expect.stringMatching(/provider-side TTL remains the cleanup backstop/i),
    });
  });

  it("puts a default deadline on Box status requests used by active resource leases", async () => {
    let observedSignal: AbortSignal | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal;
      return response(200, { boxes: [] });
    }));
    await expect(boxStatus({ box: { token: "test-token" } }, "bot-hung"))
      .resolves.toEqual({ configured: true, box: null });
    expect(observedSignal).toBeInstanceOf(AbortSignal);
  });

  it("best-effort resumes the owned Box after metadata deletion rolls back", async () => {
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bot-rollback"))).toString("hex");
    const boxName = `cumea-botroll-${digest.slice(0, 6)}`;
    const calls: string[] = [];
    const states = ["archiving", "archived"];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).endsWith("/boxes")) {
        return response(200, { boxes: [{ id: "box-restored", name: boxName, state: states.shift() ?? "archived" }] });
      }
      if (String(url).endsWith("/boxes/box-restored/resume")) return response(200, { ok: true });
      throw new Error(`unexpected fetch: ${url}`);
    }));
    await expect(resumeBoxAfterDeletionRollback({ box: { token: "test-token" } }, "bot-rollback"))
      .resolves.toEqual({ outcome: "resume-requested" });
    expect(calls.filter((url) => url.endsWith("/boxes"))).toHaveLength(2);
    expect(calls.at(-1)).toMatch(/\/boxes\/box-restored\/resume$/);
  });
});

describe("Box screenshots", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function stubScreenshot(content: string) {
    const botId = "bot-shot";
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botId))).toString("hex");
    const boxName = `cumea-botshot-${digest.slice(0, 6)}`;
    const calls: Array<{ url: string; command?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/boxes")) return response(200, { boxes: [{ id: "box-shot", name: boxName, state: "idle" }] });
      if (target.endsWith("/boxes/box-shot/commands")) {
        const command = String(JSON.parse(String(init?.body)).command);
        calls.push({ url: target, command });
        return response(200, { exitCode: 0, stdout: command.startsWith("rm -f") ? "" : "captured\n", stderr: "" });
      }
      if (target.includes("/boxes/box-shot/files?")) {
        calls.push({ url: target });
        return response(200, { ok: true, content });
      }
      throw new Error(`unexpected fetch: ${target}`);
    }));
    return { botId, calls };
  }

  it("accepts a canonical bounded PNG and removes its random snapshot", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const { botId, calls } = await stubScreenshot(png);
    await expect(screenshotBox({ box: { token: "test-token" } }, botId))
      .resolves.toEqual({ png, format: "png" });
    const fileUrl = decodeURIComponent(calls.find((call) => call.url.includes("/files?"))!.url);
    expect(fileUrl).toMatch(/path=\/tmp\/cumea-panel-[a-f0-9]{36}\.png/);
    expect(calls.at(-1)?.command).toMatch(/^rm -f -- \/tmp\/cumea-panel-[a-f0-9]{36}\.png$/);
  });

  it("rejects an encoded frame above the 5 MiB ceiling before decoding", async () => {
    const maxEncodedLength = Math.ceil((5 * 1024 * 1024) / 3) * 4;
    const { botId, calls } = await stubScreenshot("A".repeat(maxEncodedLength + 4));
    await expect(screenshotBox({ box: { token: "test-token" } }, botId))
      .rejects.toThrow(/canonical base64/i);
    expect(calls.at(-1)?.command).toMatch(/^rm -f -- /);
  });

  it("rejects canonical base64 whose decoded bytes are not PNG", async () => {
    const { botId, calls } = await stubScreenshot(Buffer.from("not a png", "utf8").toString("base64"));
    await expect(screenshotBox({ box: { token: "test-token" } }, botId))
      .rejects.toThrow(/not a PNG/i);
    expect(calls.at(-1)?.command).toMatch(/^rm -f -- /);
  });
});
