import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

type HarnessChild = ChildProcessByStdio<null, Readable, Readable>;
const children = new Set<HarnessChild>();
const directories = new Set<string>();
const servers = new Set<HttpServer>();

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("condition did not become true in time");
}

async function stop(child: HarnessChild, signal: NodeJS.Signals = "SIGTERM") {
  children.delete(child);
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve();
    }, 2_000);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try { child.kill(signal); } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

afterEach(async () => {
  await Promise.all([...children].map((child) => stop(child)));
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => {
    servers.delete(server);
    server.close(() => resolve());
  })));
  await Promise.all([...directories].map(async (directory) => {
    directories.delete(directory);
    await rm(directory, { recursive: true, force: true });
  }));
});

async function fakeXai() {
  const streamingBodies: any[] = [];
  let releaseFirst!: () => void;
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstReleased = false;
  const release = () => {
    if (firstReleased) return;
    firstReleased = true;
    releaseFirst();
  };

  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk.toString("utf8");
    const body = raw ? JSON.parse(raw) : {};
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    if (body.stream !== true) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "fixture title" } }] }));
      return;
    }

    const index = streamingBodies.push(body) - 1;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    const text = index === 0 ? "first answer" : `follow-up ${index}`;
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    if (index === 0) await firstRelease;
    if (!res.destroyed) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.add(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind TCP");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    streamingBodies,
    releaseFirst: release,
  };
}

async function startHarness(input: { dataDir?: string; xaiUrl: string }) {
  const dataDir = input.dataDir ?? await mkdtemp(path.join(os.tmpdir(), "cumea-steering-harness-"));
  directories.add(dataDir);
  await mkdir(dataDir, { recursive: true });
  const configPath = path.join(dataDir, "config.json");
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        xai: { key: "xai-fixture" },
        instances: {
          grok: { driver: "grok", config: { url: input.xaiUrl } },
        },
      }),
      { mode: 0o600, flag: "wx" },
    );
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
  }

  const child = spawn(process.execPath, ["server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CUMEA_DATA_DIR: dataDir,
      CUMEA_PORT: "0",
      CUMEA_REMOTE_ACCESS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const port = await new Promise<number>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (work: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      work();
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const match = stdout.match(/Cumea server running on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) finish(() => resolve(Number(match[1])));
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => finish(() => reject(new Error(
      `harness exited before listening (${code ?? signal ?? "unknown"}): ${stderr.slice(-1_200)}`,
    ))));
    const timer = setTimeout(
      () => finish(() => reject(new Error(`harness did not listen in time: ${stderr.slice(-1_200)}`))),
      15_000,
    );
    timer.unref?.();
  });
  return { child, dataDir, port };
}

async function request(port: number, route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function createBot(port: number) {
  const created = await request(port, "/api/bots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(created.response.status).toBe(201);
  return (created.body as any).bot as { id: string; threadId: string };
}

async function send(port: number, botId: string, text: string) {
  return request(port, `/api/bots/${botId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function transcript(port: number, botId: string) {
  const page = await request(port, `/api/bots/${botId}/messages?limit=80`);
  expect(page.response.status).toBe(200);
  return ((page.body as any).messages ?? []) as Array<{ id: string; text?: string; delivery?: string }>;
}

function occurrences(value: unknown, needle: string) {
  return JSON.stringify(value).split(needle).length - 1;
}

describe("busy attended steering", () => {
  it("persists steering immediately and drains multiple notes into one follow-up without prompt duplication", async () => {
    const xai = await fakeXai();
    const harness = await startHarness({ xaiUrl: xai.url });
    const bot = await createBot(harness.port);

    const first = await send(harness.port, bot.id, "initial task");
    expect(first.response.status).toBe(202);
    expect((first.body as any).queued).toBe(false);
    await waitFor(() => xai.streamingBodies.length === 1);

    const steerOne = await send(harness.port, bot.id, "steer one");
    const steerTwo = await send(harness.port, bot.id, "steer two");
    expect(steerOne.response.status).toBe(202);
    expect(steerTwo.response.status).toBe(202);
    expect((steerOne.body as any).queued).toBe(true);
    expect((steerTwo.body as any).queued).toBe(true);
    const queuedIds = [(steerOne.body as any).message.id, (steerTwo.body as any).message.id];

    const before = await transcript(harness.port, bot.id);
    expect(before.filter((message) => queuedIds.includes(message.id)).map((message) => message.delivery)).toEqual(["queued", "queued"]);

    xai.releaseFirst();
    await waitFor(() => xai.streamingBodies.length === 2);
    const followUp = xai.streamingBodies[1];
    const last = followUp.messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content).toContain("[Steering note 1/2]\nsteer one");
    expect(last.content).toContain("[Steering note 2/2]\nsteer two");
    expect(occurrences(followUp.messages, "steer one")).toBe(1);
    expect(occurrences(followUp.messages, "steer two")).toBe(1);
    expect(occurrences(followUp.messages, "initial task")).toBe(1);

    await waitFor(async () => {
      const after = await transcript(harness.port, bot.id);
      return after.filter((message) => queuedIds.includes(message.id)).every((message) => message.delivery === undefined);
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(xai.streamingBodies).toHaveLength(2);
  }, 30_000);

  it("recovers durable queued steering after a process crash instead of leaving a false queued promise", async () => {
    const xai = await fakeXai();
    const firstHarness = await startHarness({ xaiUrl: xai.url });
    const bot = await createBot(firstHarness.port);

    await send(firstHarness.port, bot.id, "long running task");
    await waitFor(() => xai.streamingBodies.length === 1);
    const steering = await send(firstHarness.port, bot.id, "recover this steering note");
    expect((steering.body as any).queued).toBe(true);
    const queuedId = (steering.body as any).message.id as string;

    await stop(firstHarness.child, "SIGKILL");
    xai.releaseFirst();

    const restarted = await startHarness({ dataDir: firstHarness.dataDir, xaiUrl: xai.url });
    await waitFor(() => xai.streamingBodies.length >= 2, 15_000);
    const recovered = xai.streamingBodies.at(-1);
    expect(occurrences(recovered.messages, "recover this steering note")).toBe(1);
    expect(recovered.messages.at(-1)?.content).toContain("recover this steering note");

    await waitFor(async () => {
      const messages = await transcript(restarted.port, bot.id);
      return messages.find((message) => message.id === queuedId)?.delivery === undefined;
    });
  }, 35_000);
});
