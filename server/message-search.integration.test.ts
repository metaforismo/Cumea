import { spawn, type ChildProcessByStdio } from "node:child_process";
import { access, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";
import { TranscriptStore } from "./transcript-store.ts";

type HarnessChild = ChildProcessByStdio<null, Readable, Readable>;
const children = new Set<HarnessChild>();
const directories = new Set<string>();

async function stop(child: HarnessChild) {
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
    try { child.kill("SIGTERM"); } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

afterEach(async () => {
  await Promise.all([...children].map(stop));
  await Promise.all([...directories].map(async (directory) => {
    directories.delete(directory);
    await rm(directory, { recursive: true, force: true });
  }));
});

async function reserveLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = probe.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (!port) throw new Error("could not reserve a loopback port");
  return port;
}

async function startHarness(options: { remote?: boolean; dataDir?: string } = {}): Promise<{
  child: HarnessChild;
  port: number;
  dataDir: string;
  remotePort?: number;
}> {
  const dataDir = options.dataDir ?? await mkdtemp(path.join(os.tmpdir(), "cumea-search-harness-"));
  if (!options.dataDir) directories.add(dataDir);
  const remotePort = options.remote ? await reserveLoopbackPort() : undefined;
  const child = spawn(process.execPath, ["server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CUMEA_DATA_DIR: dataDir,
      CUMEA_PORT: "0",
      CUMEA_REMOTE_ACCESS: options.remote ? "1" : "0",
      ...(remotePort
        ? {
            CUMEA_REMOTE_PORT: String(remotePort),
            CUMEA_REMOTE_PUBLIC_URL: `http://127.0.0.1:${remotePort}`,
            CUMEA_REMOTE_ALLOW_INSECURE: "1",
          }
        : {}),
      CUMEA_PERFORMANCE_MODE: "1",
      CUMEA_PERFORMANCE_FILE: path.join(dataDir, "fixture-performance.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);

  const port = await new Promise<number>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const match = stdout.match(/Cumea server running on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) finish(() => resolve(Number(match[1])));
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => finish(() => reject(new Error(
      `harness exited before listening (${code ?? signal ?? "unknown"}): ${stderr.slice(-1_000)}`,
    ))));
    const timer = setTimeout(
      () => finish(() => reject(new Error(`harness did not listen in time: ${stderr.slice(-1_000)}`))),
      15_000,
    );
    timer.unref?.();
  });
  return { child, port, dataDir, ...(remotePort ? { remotePort } : {}) };
}

async function json(port: number, route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, init);
  const body = await response.json();
  return { response, body };
}

describe("local transcript search integration", () => {
  it("indexes creation-time canonical messages and removes canonical/search state with the real HTTP deletion lifecycle", async () => {
    const harness = await startHarness();
    const created = await json(harness.port, "/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Searchable" }),
    });
    expect(created.response.status).toBe(201);
    const botId = String((created.body as any).bot.id);
    const threadId = String((created.body as any).bot.threadId);

    const found = await json(harness.port, "/api/search/messages?q=nice%20to%20meet&limit=10");
    expect(found.response.status).toBe(200);
    expect((found.body as any).available).toBe(true);
    expect((found.body as any).hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ botId, botName: "Searchable" })]),
    );
    await expect(access(path.join(harness.dataDir, `messages-${threadId}.json`))).rejects.toMatchObject({ code: "ENOENT" });

    const removed = await json(harness.port, `/api/bots/${botId}`, {
      method: "DELETE",
      headers: { "x-cumea-operation-id": "search-index-delete-test" },
    });
    expect(removed.response.status).toBe(200);

    const afterDelete = await json(harness.port, "/api/search/messages?q=nice%20to%20meet&limit=10");
    expect((afterDelete.body as any).hits.some((hit: { botId?: string }) => hit.botId === botId)).toBe(false);
    await stop(harness.child);

    const canonical = new TranscriptStore(path.join(harness.dataDir, "transcripts.sqlite"));
    try {
      expect(canonical.threadState(threadId)).toBeNull();
    } finally {
      canonical.close();
    }
  });

  it("restores bot, canonical SQLite, and search when a cache-cold HTTP deletion cannot commit bot metadata", async () => {
    const first = await startHarness();
    const created = await json(first.port, "/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Cold rollback" }),
    });
    expect(created.response.status).toBe(201);
    const botId = String((created.body as any).bot.id);
    const threadId = String((created.body as any).bot.threadId);
    await stop(first.child);

    const restarted = await startHarness({ dataDir: first.dataDir });
    const botsFile = path.join(first.dataDir, "bots.json");
    const botsBackup = path.join(first.dataDir, "bots.json.rollback-test");
    await rename(botsFile, botsBackup);
    await mkdir(botsFile);

    const failed = await json(restarted.port, `/api/bots/${botId}`, {
      method: "DELETE",
      headers: { "x-cumea-operation-id": "cold-http-rollback" },
    });
    expect(failed.response.status).toBe(500);

    const found = await json(restarted.port, "/api/search/messages?q=nice%20to%20meet&limit=20");
    expect((found.body as any).hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ botId, botName: "Cold rollback" })]),
    );
    await expect(access(path.join(first.dataDir, `messages-${threadId}.json`))).rejects.toMatchObject({ code: "ENOENT" });

    await rm(botsFile, { recursive: true, force: true });
    await rename(botsBackup, botsFile);
    await stop(restarted.child);

    const canonical = new TranscriptStore(path.join(first.dataDir, "transcripts.sqlite"));
    try {
      expect(canonical.threadState(threadId)).toMatchObject({ state: "active" });
      expect(canonical.messagesFor(threadId).some((message) => message.text?.toLowerCase().includes("nice to meet"))).toBe(true);
    } finally {
      canonical.close();
    }
  });

  it("recovers an interrupted pending canonical delete when the bot still exists at restart", async () => {
    const first = await startHarness();
    const created = await json(first.port, "/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Pending recovery" }),
    });
    expect(created.response.status).toBe(201);
    const botId = String((created.body as any).bot.id);
    const threadId = String((created.body as any).bot.threadId);
    await stop(first.child);

    const canonical = new TranscriptStore(path.join(first.dataDir, "transcripts.sqlite"));
    canonical.stageDelete(threadId); // leave durable pending_delete, simulating process death
    expect(canonical.threadState(threadId)?.state).toBe("pending_delete");
    canonical.close();

    const restarted = await startHarness({ dataDir: first.dataDir });
    const bots = await json(restarted.port, "/api/bots");
    expect((bots.body as any).bots).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: botId, threadId })]),
    );
    const found = await json(restarted.port, "/api/search/messages?q=nice%20to%20meet&limit=20");
    expect((found.body as any).hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ botId, botName: "Pending recovery" })]),
    );
    await stop(restarted.child);

    const recovered = new TranscriptStore(path.join(first.dataDir, "transcripts.sqlite"));
    try {
      expect(recovered.threadState(threadId)?.state).toBe("active");
    } finally {
      recovered.close();
    }
  });

  it("rejects unbounded local queries", async () => {
    const { port } = await startHarness();
    const invalid = await json(port, "/api/search/messages?q=x&limit=0");
    expect(invalid.response.status).toBe(400);
  });

  it("does not expose transcript search on the authenticated remote/mobile surface", async () => {
    const { port, remotePort } = await startHarness({ remote: true });
    expect(remotePort).toBeTypeOf("number");

    const session = await json(port, "/api/pairing/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ttlMs: 60_000 }),
    });
    expect(session.response.status).toBe(201);

    const claim = await fetch(`http://127.0.0.1:${remotePort}/api/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: (session.body as any).session.id,
        secret: (session.body as any).session.secret,
        deviceName: "Search boundary test",
      }),
    });
    expect(claim.status).toBe(201);
    const token = String(((await claim.json()) as any).token);

    const remoteSearch = await fetch(`http://127.0.0.1:${remotePort}/api/search/messages?q=private`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(remoteSearch.status).toBe(403);
    expect(await remoteSearch.json()).toEqual({ error: "endpoint is not available to mobile devices" });
  });
});
