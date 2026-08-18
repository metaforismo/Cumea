import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

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

async function reserveLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (!port) throw new Error("could not reserve loopback port");
  return port;
}

afterEach(async () => {
  await Promise.all([...children].map(stop));
  await Promise.all([...directories].map(async (directory) => {
    directories.delete(directory);
    await rm(directory, { recursive: true, force: true });
  }));
});

async function startHarness(remote = false): Promise<{ child: HarnessChild; port: number; remotePort?: number }> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cumea-nav-harness-"));
  directories.add(dataDir);
  const remotePort = remote ? await reserveLoopbackPort() : undefined;
  const child = spawn(process.execPath, ["server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CUMEA_DATA_DIR: dataDir,
      CUMEA_PORT: "0",
      CUMEA_REMOTE_ACCESS: remote ? "1" : "0",
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
  return { child, port, ...(remotePort ? { remotePort } : {}) };
}

async function json(port: number, route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, init);
  const body = await response.json();
  return { response, body };
}

describe("transcript navigation/export API", () => {
  it("returns an exact bounded local window and visible Markdown/JSON exports", async () => {
    const { port } = await startHarness();
    const created = await json(port, "/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Navigation" }),
    });
    expect(created.response.status).toBe(201);
    const bot = (created.body as any).bot;
    const focusId = String(bot.messages[0].id);

    const window = await json(
      port,
      `/api/bots/${encodeURIComponent(bot.id)}/messages?around=${encodeURIComponent(focusId)}&limit=40`,
    );
    expect(window.response.status).toBe(200);
    expect((window.body as any).focusMessageId).toBe(focusId);
    expect((window.body as any).messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: focusId })]),
    );
    expect((window.body as any).messages.length).toBeLessThanOrEqual(40);

    const missing = await json(port, `/api/bots/${bot.id}/messages?around=does-not-exist&limit=40`);
    expect(missing.response.status).toBe(404);

    const markdown = await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}/export?format=markdown`);
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toContain("text/markdown");
    expect(markdown.headers.get("content-disposition")).toContain("Navigation.md");
    const markdownText = await markdown.text();
    expect(markdownText).toContain("# Navigation");
    expect(markdownText).toContain("Nice to meet you");

    const exportedJson = await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}/export?format=json`);
    expect(exportedJson.status).toBe(200);
    const document = await exportedJson.json() as any;
    expect(document.schema).toBe("cumea.visible-transcript.v1");
    expect(document.bot).toMatchObject({ name: "Navigation" });
    expect(JSON.stringify(document)).not.toContain("resumeCursors");
  });

  it("keeps exact navigation and export off the paired remote/mobile surface", async () => {
    const { port, remotePort } = await startHarness(true);
    expect(remotePort).toBeTypeOf("number");

    const created = await json(port, "/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Private navigation" }),
    });
    const bot = (created.body as any).bot;
    const focusId = String(bot.messages[0].id);

    const session = await json(port, "/api/pairing/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ttlMs: 60_000 }),
    });
    const claim = await fetch(`http://127.0.0.1:${remotePort}/api/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: (session.body as any).session.id,
        secret: (session.body as any).session.secret,
        deviceName: "Navigation boundary",
      }),
    });
    expect(claim.status).toBe(201);
    const token = String(((await claim.json()) as any).token);
    const headers = { authorization: `Bearer ${token}` };

    const around = await fetch(
      `http://127.0.0.1:${remotePort}/api/bots/${bot.id}/messages?around=${encodeURIComponent(focusId)}&limit=40`,
      { headers },
    );
    expect(around.status).toBe(403);

    const exported = await fetch(`http://127.0.0.1:${remotePort}/api/bots/${bot.id}/export?format=markdown`, { headers });
    expect(exported.status).toBe(403);
  });
});
