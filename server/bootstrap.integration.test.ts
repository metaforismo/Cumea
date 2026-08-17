import { spawn, type ChildProcessByStdio } from "node:child_process";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  DESKTOP_BOOTSTRAP_BOT_LIMIT,
  DESKTOP_BOOTSTRAP_MESSAGE_LIMIT,
  DESKTOP_BOOTSTRAP_SCHEMA,
  DESKTOP_BOOTSTRAP_VERSION,
} from "./bootstrap.ts";

type HarnessChild = ChildProcessByStdio<null, Readable, Readable>;
const children = new Set<HarnessChild>();
const tempDirs = new Set<string>();

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
  await Promise.all([...tempDirs].map(async (directory) => {
    tempDirs.delete(directory);
    await rm(directory, { recursive: true, force: true });
  }));
});

async function startHarness(): Promise<{ child: HarnessChild; port: number }> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cumea-bootstrap-"));
  tempDirs.add(dataDir);
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

function sseClient(port: number): Promise<{ next: () => Promise<Record<string, unknown>>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, path: "/api/events", method: "GET" },
      (response: IncomingMessage) => {
        if (response.statusCode !== 200) {
          reject(new Error(`SSE returned ${response.statusCode}`));
          request.destroy();
          return;
        }
        let buffer = "";
        const queue: Record<string, unknown>[] = [];
        const waiters: Array<(value: Record<string, unknown>) => void> = [];
        const push = (value: Record<string, unknown>) => {
          const waiter = waiters.shift();
          if (waiter) waiter(value);
          else queue.push(value);
        };
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          buffer += chunk;
          for (;;) {
            const boundary = buffer.indexOf("\n\n");
            if (boundary < 0) break;
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
            if (!dataLine) continue;
            const parsed = JSON.parse(dataLine.slice("data: ".length));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) push(parsed);
          }
        });
        resolve({
          next: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise((wait) => waiters.push(wait)),
          close: () => {
            response.destroy();
            request.destroy();
          },
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function createBot(port: number, name: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/bots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(`bot creation failed: ${response.status}`);
  return response.json() as Promise<{ bot: { id: string } }>;
}

async function bootstrap(port: number, selectedBotId?: string) {
  const url = new URL(`http://127.0.0.1:${port}/api/bootstrap`);
  if (selectedBotId) url.searchParams.set("selectedBotId", selectedBotId);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`bootstrap failed: ${response.status}`);
  return response.json() as Promise<any>;
}

describe("desktop bootstrap integration", () => {
  it("orders the snapshot and subsequent SSE deltas with one monotonic cursor", async () => {
    const { port } = await startHarness();
    const sse = await sseClient(port);
    try {
      const hello = await sse.next();
      expect(hello.kind).toBe("hello");
      expect(Number.isSafeInteger(hello.eventCursor)).toBe(true);

      const firstCreated = await createBot(port, "Cursor One");
      const firstEvent = await sse.next();
      expect(firstEvent.kind).toBe("bot");
      expect(Number(firstEvent.eventCursor)).toBeGreaterThan(Number(hello.eventCursor));

      const snapshot = await bootstrap(port, firstCreated.bot.id);
      expect(snapshot.schema).toBe(DESKTOP_BOOTSTRAP_SCHEMA);
      expect(snapshot.version).toBe(DESKTOP_BOOTSTRAP_VERSION);
      expect(snapshot.selected.botId).toBe(firstCreated.bot.id);
      expect(snapshot.bots.length).toBeLessThanOrEqual(DESKTOP_BOOTSTRAP_BOT_LIMIT);
      expect(snapshot.selected.page.messages.length).toBeLessThanOrEqual(DESKTOP_BOOTSTRAP_MESSAGE_LIMIT);
      expect(snapshot.bots.every((bot: Record<string, unknown>) => !("resumeCursors" in bot))).toBe(true);
      expect(Number(snapshot.eventCursor)).toBeGreaterThanOrEqual(Number(firstEvent.eventCursor));

      await createBot(port, "Cursor Two");
      const secondEvent = await sse.next();
      expect(secondEvent.kind).toBe("bot");
      expect(Number(secondEvent.eventCursor)).toBeGreaterThan(Number(snapshot.eventCursor));
    } finally {
      sse.close();
    }
  });
});
