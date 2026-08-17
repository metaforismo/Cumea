import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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

afterEach(async () => {
  await Promise.all([...children].map(stop));
  await Promise.all([...directories].map(async (directory) => {
    directories.delete(directory);
    await rm(directory, { recursive: true, force: true });
  }));
});

async function startHarness(): Promise<{ child: HarnessChild; port: number }> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cumea-search-harness-"));
  directories.add(dataDir);
  const child = spawn(process.execPath, ["server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CUMEA_DATA_DIR: dataDir,
      CUMEA_PORT: "0",
      CUMEA_REMOTE_ACCESS: "0",
      CUMEA_PERFORMANCE_MODE: "1",
      CUMEA_PERFORMANCE_FILE: path.join(dataDir, "fixture-performance.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);

  return await new Promise((resolve, reject) => {
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
      if (match) finish(() => resolve({ child, port: Number(match[1]) }));
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
}

async function json(port: number, route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, init);
  const body = await response.json();
  return { response, body };
}

describe("local transcript search integration", () => {
  it("indexes a visible message and removes its hits with the real bot deletion lifecycle", async () => {
    const { port } = await startHarness();
    const created = await json(port, "/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Searchable" }),
    });
    expect(created.response.status).toBe(201);
    const botId = String((created.body as any).bot.id);

    const sent = await json(port, `/api/bots/${botId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "copper lighthouse regression note", track: false }),
    });
    expect(sent.response.status).toBe(202);

    const found = await json(port, "/api/search/messages?q=copper%20lighthouse&limit=10");
    expect(found.response.status).toBe(200);
    expect((found.body as any).available).toBe(true);
    expect((found.body as any).hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ botId, botName: "Searchable" }),
      ]),
    );

    const removed = await json(port, `/api/bots/${botId}`, {
      method: "DELETE",
      headers: { "x-cumea-operation-id": "search-index-delete-test" },
    });
    expect(removed.response.status).toBe(200);

    const afterDelete = await json(port, "/api/search/messages?q=copper%20lighthouse&limit=10");
    expect(afterDelete.response.status).toBe(200);
    expect((afterDelete.body as any).hits).toEqual([]);
  });

  it("keeps transcript search local-only", async () => {
    const { port } = await startHarness();
    const invalid = await json(port, "/api/search/messages?q=x&limit=0");
    expect(invalid.response.status).toBe(400);
  });
});
