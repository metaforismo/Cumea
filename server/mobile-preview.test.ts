import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 29_000 + Math.floor(Math.random() * 4_000);
const REMOTE_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const REMOTE_BASE = `http://127.0.0.1:${REMOTE_PORT}`;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=";
const SENTINEL = "Authorization: Bearer workspace-provider-sentinel";

let child: ChildProcess;
let directory: string;
let stderr = "";
let auth: Record<string, string>;

async function openRemoteEventStream() {
  const controller = new AbortController();
  const response = await fetch(`${REMOTE_BASE}/api/events`, { headers: auth, signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`event stream failed with ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(timeoutMs = 5_000): Promise<any> {
      const read = async () => {
        for (;;) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (data) return JSON.parse(data);
            continue;
          }
          const chunk = await reader.read();
          if (chunk.done) throw new Error("event stream closed before the next event");
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      };
      return Promise.race([
        read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for SSE")), timeoutMs)),
      ]);
    },
    close() {
      controller.abort();
    },
  };
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "cumea-mobile-preview-"));
  const dataDir = join(directory, "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "config.json"),
    JSON.stringify({ instances: { ghost: { driver: "not-a-real-driver", displayName: "Ghost" } } }),
  );
  writeFileSync(
    join(dataDir, "bots.json"),
    JSON.stringify([
      {
        id: "preview-bot",
        threadId: "preview-thread",
        name: "Preview bot",
        title: "Read only",
        description: "",
        notifications: true,
        color: "orange",
        avatar: { kind: "mote", shapeId: "drop", color: "#f56a16", motion: "playful" },
        unread: false,
        modelSelection: { instanceId: "ghost", model: "private-model-name" },
        resumeCursors: { ghost: "private-provider-session" },
        createdAt: 100,
      },
      {
        id: "hidden-bot",
        threadId: "hidden-thread",
        name: "Hidden provider bot",
        title: SENTINEL,
        description: SENTINEL,
        notifications: true,
        color: "orange",
        avatar: { kind: "mote", shapeId: "drop", color: "#f56a16", motion: "playful" },
        unread: false,
        hidden: true,
        modelSelection: { instanceId: "ghost", model: SENTINEL },
        resumeCursors: { ghost: SENTINEL },
        createdAt: 101,
      },
    ]),
  );
  writeFileSync(
    join(dataDir, "messages-preview-thread.json"),
    JSON.stringify([
      {
        id: "screen-1",
        role: "bot",
        kind: "screen",
        png: PNG,
        mime: "image/png",
        at: 123_456,
      },
    ]),
  );
  writeFileSync(
    join(dataDir, "workspace.json"),
    JSON.stringify({
      sections: [{ id: "section-1", name: "Operations", createdAt: 1 }],
      attachments: [],
      tasks: [
        {
          id: "visible-task",
          botId: "preview-bot",
          title: SENTINEL,
          prompt: SENTINEL,
          source: "message",
          status: "needs_attention",
          attachmentIds: [],
          latestRunId: "visible-run",
          createdAt: 2,
          updatedAt: 3,
        },
        {
          id: "hidden-task",
          botId: "hidden-bot",
          title: SENTINEL,
          prompt: SENTINEL,
          source: "message",
          status: "failed",
          attachmentIds: [],
          createdAt: 2,
          updatedAt: 3,
        },
      ],
      runs: [{
        id: "visible-run",
        taskId: "visible-task",
        botId: "preview-bot",
        status: "failed",
        steps: [{ id: "step-1", kind: "tool", title: SENTINEL, status: "failed", startedAt: 4, completedAt: 5 }],
        artifacts: [],
        startedAt: 4,
        completedAt: 5,
        error: SENTINEL,
      }],
      routines: [{
        id: "visible-routine",
        botId: "preview-bot",
        name: "Inbox pass",
        prompt: SENTINEL,
        schedule: { kind: "interval", everyMinutes: 30 },
        enabled: true,
        nextRunAt: Date.now() + 3_600_000,
        createdAt: 6,
        updatedAt: 7,
        lastStatus: "failed",
        lastError: SENTINEL,
      }],
    }),
  );

  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      CUMEA_DATA_DIR: dataDir,
      CUMEA_PORT: String(PORT),
      CUMEA_REMOTE_ACCESS: "1",
      CUMEA_REMOTE_PORT: String(REMOTE_PORT),
      CUMEA_REMOTE_PUBLIC_URL: REMOTE_BASE,
      CUMEA_REMOTE_ALLOW_INSECURE: "1",
      CUMEA_REMOTE_SCREEN_PREVIEW: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
    if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const session = await fetch(`${BASE}/api/pairing/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const pairing = ((await session.json()) as any).session;
  const claim = await fetch(`${REMOTE_BASE}/api/pairing/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: pairing.id, secret: pairing.secret, deviceName: "Preview test" }),
  });
  const token = ((await claim.json()) as any).token;
  auth = { authorization: `Bearer ${token}` };
}, 30_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on("close", () => resolve());
    setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
  });
  rmSync(directory, { recursive: true, force: true });
});

describe("opt-in mobile computer preview", () => {
  it("advertises the capability and returns only a bounded cached image", async () => {
    const bootstrap = await fetch(`${REMOTE_BASE}/api/mobile/bootstrap`, { headers: auth });
    const bootstrapBody = (await bootstrap.json()) as any;
    expect(bootstrapBody).toMatchObject({ capabilities: { computerPreview: true } });
    expect(bootstrapBody.workspace.tasks).toContainEqual(expect.objectContaining({
      id: "visible-task",
      status: "needs_attention",
      needsAttention: true,
    }));
    expect(JSON.stringify(bootstrapBody)).not.toContain(SENTINEL);
    expect(JSON.stringify(bootstrapBody)).not.toContain("hidden-bot");
    const health = await fetch(`${REMOTE_BASE}/api/health`, { headers: auth });
    expect((await health.json()) as any).toMatchObject({ capabilities: { computerPreview: true } });

    const unauthenticated = await fetch(`${REMOTE_BASE}/api/bots/preview-bot/computer-preview`);
    expect(unauthenticated.status).toBe(401);
    const preview = await fetch(`${REMOTE_BASE}/api/bots/preview-bot/computer-preview`, { headers: auth });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    const body = (await preview.json()) as any;
    expect(body).toEqual({ available: true, mime: "image/png", png: PNG, capturedAt: 123_456 });
    const encoded = JSON.stringify(body);
    expect(encoded).not.toContain("data:image");
    expect(encoded).not.toContain("private-model-name");
    expect(encoded).not.toContain("private-provider-session");
  });

  it("projects durable work by allowlist in bootstrap, work, and SSE", async () => {
    const work = await fetch(`${REMOTE_BASE}/api/work`, { headers: auth });
    const workBody = (await work.json()) as any;
    expect(workBody.workspace.routines).toContainEqual(expect.objectContaining({
      id: "visible-routine",
      name: "Inbox pass",
      lastStatus: "failed",
    }));
    const encodedWork = JSON.stringify(workBody);
    expect(encodedWork).not.toContain(SENTINEL);
    expect(encodedWork).not.toContain("hidden-task");
    for (const forbidden of ["lastError", "error", "prompt", "title", "label"]) {
      expect(encodedWork).not.toContain(forbidden);
    }

    const stream = await openRemoteEventStream();
    expect(await stream.next()).toEqual({ kind: "hello" });
    const created = await fetch(`${BASE}/api/sections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Finance" }),
    });
    expect(created.status).toBe(201);
    const event = await stream.next();
    expect(event).toMatchObject({ kind: "workspace", workspace: { routines: [{ id: "visible-routine" }] } });
    const encodedEvent = JSON.stringify(event);
    expect(encodedEvent).not.toContain(SENTINEL);
    expect(encodedEvent).not.toContain("hidden-bot");
    stream.close();
  });

  it("returns unavailable for a bot with no cached or transcript frame", async () => {
    const created = await fetch(`${REMOTE_BASE}/api/bots`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "No screen" }),
    });
    const bot = ((await created.json()) as any).bot;
    const preview = await fetch(`${REMOTE_BASE}/api/bots/${bot.id}/computer-preview`, { headers: auth });
    expect(await preview.json()).toEqual({ available: false });
  });

  it("never forwards hidden bot, message, or runtime state over remote SSE", async () => {
    const stream = await openRemoteEventStream();
    expect(await stream.next()).toEqual({ kind: "hello" });

    const created = await fetch(`${BASE}/api/bots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Temporarily visible" }),
    });
    const hiddenLater = ((await created.json()) as any).bot;
    expect(await stream.next()).toMatchObject({ kind: "bot", bot: { id: hiddenLater.id } });

    // An already-hidden bot patch produces no remote event. Hiding a visible
    // bot produces only a tombstone so the companion can remove its row.
    expect((await fetch(`${BASE}/api/bots/hidden-bot`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unread: true }),
    })).status).toBe(200);
    expect((await fetch(`${BASE}/api/bots/${hiddenLater.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    })).status).toBe(200);
    expect(await stream.next()).toEqual({ kind: "bot.deleted", botId: hiddenLater.id });

    const hiddenMessage = `${SENTINEL} hidden-thread-message`;
    const hiddenTurn = await fetch(`${BASE}/api/bots/${hiddenLater.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: hiddenMessage }),
    });
    expect(hiddenTurn.status).toBe(409);
    expect((await fetch(`${REMOTE_BASE}/api/bots/${hiddenLater.id}/messages`, { headers: auth })).status).toBe(404);

    const markerResponse = await fetch(`${REMOTE_BASE}/api/bots`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "Visible marker" }),
    });
    const marker = ((await markerResponse.json()) as any).bot;
    const observed: any[] = [];
    for (let index = 0; index < 20; index += 1) {
      const event = await stream.next();
      observed.push(event);
      if (event.kind === "bot" && event.bot?.id === marker.id) break;
    }
    expect(observed.at(-1)).toMatchObject({ kind: "bot", bot: { id: marker.id, name: "Visible marker" } });
    const encoded = JSON.stringify(observed);
    expect(encoded).not.toContain(SENTINEL);
    expect(encoded).not.toContain(hiddenLater.id);
    expect(encoded).not.toContain("hidden-bot");
    stream.close();

    const bootstrap = await fetch(`${REMOTE_BASE}/api/mobile/bootstrap`, { headers: auth });
    const bootstrapBody = (await bootstrap.json()) as any;
    expect(bootstrapBody.bots.some((bot: any) => bot.id === hiddenLater.id || bot.id === "hidden-bot")).toBe(false);
    expect(JSON.stringify(bootstrapBody)).not.toContain(SENTINEL);
  });
});
