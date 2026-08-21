// API smoke test: boots the real harness server (node server/index.ts)
// against a throwaway home directory and exercises the HTTP surface the
// app depends on. The config pins one deliberately-unknown driver so the
// suite is deterministic with or without agent CLIs installed — and pins
// the shadow-instance behavior end to end while it's at it.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request, type ClientRequest } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ATTACHMENT_MAX_COUNT_PER_BOT } from "./workspace.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const REMOTE_PORT = PORT + 1;
const REMOTE_BASE = `http://127.0.0.1:${REMOTE_PORT}`;

let child: ChildProcess;
let home: string;
let stderr = "";
let staticRoot: string;

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

function beginPausedRequest(path: string, body: string, headers: Record<string, string>) {
  let requestHandle!: ClientRequest;
  let resolveAdmitted!: () => void;
  let rejectAdmitted!: (error: Error) => void;
  let admissionSettled = false;
  const admitted = new Promise<void>((resolve, reject) => {
    resolveAdmitted = () => {
      admissionSettled = true;
      resolve();
    };
    rejectAdmitted = reject;
  });
  const response = new Promise<{ status: number; body: any }>((resolve, reject) => {
    requestHandle = request(`${BASE}${path}`, {
      method: "POST",
      headers: {
        ...headers,
        expect: "100-continue",
        "content-length": String(Buffer.byteLength(body)),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
      });
    });
    requestHandle.once("continue", resolveAdmitted);
    requestHandle.once("error", (error) => {
      if (!admissionSettled) rejectAdmitted(error);
      reject(error);
    });
    requestHandle.flushHeaders();
  });
  return {
    admitted,
    finish: () => requestHandle.end(body),
    response,
  };
}

async function openEventStream(headers: Record<string, string>, base = REMOTE_BASE) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { headers, signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`event stream failed with ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(): Promise<any> {
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
    },
    close() {
      controller.abort();
    },
  };
}

function rawHttp(target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: PORT });
    const chunks: Buffer[] = [];
    socket.once("error", reject);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.once("connect", () => socket.end(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`));
  });
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cumea-api-test-"));
  // a fleet of exactly one unknown driver: no CLI probes, no network
  mkdirSync(join(home, ".cumea"), { recursive: true });
  staticRoot = join(home, "static");
  mkdirSync(join(staticRoot, "assets"), { recursive: true });
  writeFileSync(join(staticRoot, "index.html"), "valid-static-index");
  writeFileSync(join(staticRoot, "assets", "app.js"), "valid-static-asset");
  writeFileSync(join(home, "outside-static-secret.txt"), "outside-static-secret-sentinel");
  writeFileSync(
    join(home, ".cumea", "config.json"),
    JSON.stringify({ instances: { ghost: { driver: "not-a-real-driver", displayName: "Ghost" } } }),
  );

  child = spawn(process.execPath, ["--import", join(SERVER_DIR, "test-fixtures", "box-fetch.mjs"), join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      CUMEA_PORT: String(PORT),
      CUMEA_STATIC_DIR: staticRoot,
      CUMEA_REMOTE_ACCESS: "1",
      CUMEA_REMOTE_PORT: String(REMOTE_PORT),
      CUMEA_REMOTE_PUBLIC_URL: REMOTE_BASE,
      // Tests use loopback HTTP. Production remote URLs are HTTPS-only.
      CUMEA_REMOTE_ALLOW_INSECURE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (c) => (stderr += c));

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}, 30_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on("close", () => resolve());
    setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
  });
  rmSync(home, { recursive: true, force: true });
});

describe("harness HTTP API", () => {
  it("identifies itself on /api/health", async () => {
    const { status, body } = await api("GET", "/api/health");
    expect(status).toBe(200);
    expect(body.app).toBe("cumea");
    expect(typeof body.pid).toBe("number");
  });

  it("serves valid assets but never returns outside bytes for raw encoded traversal targets", async () => {
    expect(await (await fetch(`${BASE}/assets/app.js`)).text()).toBe("valid-static-asset");
    expect(await (await fetch(`${BASE}/client/route`)).text()).toBe("valid-static-index");
    const attacks = [
      "/../outside-static-secret.txt",
      "/%2e%2e/outside-static-secret.txt",
      "/.%2e/outside-static-secret.txt",
      "/%252e%252e/outside-static-secret.txt",
      "/%2e%2e%2foutside-static-secret.txt",
      "/%252e%252e%252foutside-static-secret.txt",
      "/..%5coutside-static-secret.txt",
      "/%2e%2e%5coutside-static-secret.txt",
      "/%00outside-static-secret.txt",
      "/%2500outside-static-secret.txt",
      "/%0aoutside-static-secret.txt",
      "/%ZZ",
      "//outside-static-secret.txt",
      "/C:%5coutside-static-secret.txt",
    ];
    for (const target of attacks) {
      const response = await rawHttp(target);
      expect(response, target).toMatch(/^HTTP\/1\.1 4\d\d\b/);
      expect(response, target).not.toContain("outside-static-secret-sentinel");
      expect(response, target).not.toContain("valid-static-index");
    }
  });

  it("redacts configured secrets from persisted user input and local/remote SSE", async () => {
    const secret = "KnownSecret+42/sentinel";
    expect((await api("PUT", "/api/config", { xai: { key: secret } })).status).toBe(200);
    const session = await api("POST", "/api/pairing/sessions", { ttlMs: 60_000 });
    const claimResponse = await fetch(`${REMOTE_BASE}/api/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.body.session.id,
        secret: session.body.session.secret,
        deviceName: "Secret egress test",
      }),
    });
    const claimed = await claimResponse.json() as any;
    const auth = { authorization: `Bearer ${claimed.token}` };
    const bots = (await api("GET", "/api/bots")).body.bots as any[];
    const bot = bots.find((candidate) => !candidate.hidden)!;
    const localEvents = await openEventStream({}, BASE);
    const remoteEvents = await openEventStream(auth);
    expect(await localEvents.next()).toEqual({ kind: "hello" });
    expect(await remoteEvents.next()).toEqual({ kind: "hello" });

    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: `please keep ${secret} private` });
    expect(sent.status).toBe(409);
    const localMessage = await localEvents.next();
    const remoteMessage = await remoteEvents.next();
    expect(localMessage).toMatchObject({ kind: "message" });
    expect(remoteMessage).toMatchObject({ kind: "message" });
    expect(JSON.stringify(localMessage)).not.toContain(secret);
    expect(JSON.stringify(remoteMessage)).not.toContain(secret);
    localEvents.close();
    remoteEvents.close();

    const messages = await api("GET", `/api/bots/${bot.id}/messages`);
    expect(JSON.stringify(messages.body)).not.toContain(secret);
    const persisted = readFileSync(join(home, ".cumea", `messages-${bot.threadId}.json`), "utf8");
    expect(persisted).not.toContain(secret);

    const routine = await api("POST", "/api/routines", {
      botId: bot.id,
      name: `Routine ${secret}`,
      prompt: `Never reflect ${secret}`,
      schedule: { kind: "interval", everyMinutes: 60 },
      enabled: false,
    });
    expect(routine.status).toBe(201);
    expect(JSON.stringify(routine.body)).not.toContain(secret);
    const remoteWork = await fetch(`${REMOTE_BASE}/api/work`, { headers: auth });
    expect(remoteWork.status).toBe(200);
    expect(JSON.stringify(await remoteWork.json())).not.toContain(secret);
    expect(readFileSync(join(home, ".cumea", "workspace.json"), "utf8")).not.toContain(secret);
  });

  it("exports and dry-run validates a local portable backup", async () => {
    const exported = await fetch(`${BASE}/api/backup/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/zip");
    expect(exported.headers.get("cache-control")).toBe("no-store");
    expect(exported.headers.get("content-disposition")).toMatch(/^attachment; filename="cumea-/);
    const archive = await exported.arrayBuffer();
    expect(archive.byteLength).toBeGreaterThan(100);

    const inspected = await fetch(`${BASE}/api/backup/inspect`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: archive,
    });
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toMatchObject({ dryRun: true, botCount: 1, attachmentCount: 0 });

    const unconfirmed = await fetch(`${BASE}/api/backup/restore`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: archive,
    });
    expect(unconfirmed.status).toBe(400);
    expect(await unconfirmed.json()).toEqual({ error: "restore confirmation header is required" });
  });

  it("rejects state-changing requests from foreign browser origins", async () => {
    const res = await fetch(`${BASE}/api/bots`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "origin not allowed" });
  });

  it("pairs one remote device, gates the mobile surface, and revokes its hashed token", async () => {
    const unauthenticated = await fetch(`${REMOTE_BASE}/api/mobile/bootstrap`);
    expect(unauthenticated.status).toBe(401);

    const created = await api("POST", "/api/pairing/sessions", { ttlMs: 60_000 });
    expect(created.status).toBe(201);
    expect(created.body.session).toMatchObject({
      hostUrl: REMOTE_BASE,
      claimUrl: `${REMOTE_BASE}/api/pairing/claim`,
    });
    expect(created.body.session.verificationCode).toMatch(/^\d{6}$/);

    const claim = await fetch(`${REMOTE_BASE}/api/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: created.body.session.id,
        secret: created.body.session.secret,
        deviceName: "Test phone",
      }),
    });
    expect(claim.status).toBe(201);
    const claimed = (await claim.json()) as any;
    expect(claimed.token).toMatch(/^cumea_device_/);

    const reused = await fetch(`${REMOTE_BASE}/api/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: created.body.session.id,
        secret: created.body.session.secret,
        deviceName: "Second phone",
      }),
    });
    expect(reused.status).toBe(409);

    const auth = { authorization: `Bearer ${claimed.token}` };
    const bootstrap = await fetch(`${REMOTE_BASE}/api/mobile/bootstrap`, { headers: auth });
    expect(bootstrap.status).toBe(200);
    const snapshot = (await bootstrap.json()) as any;
    expect(snapshot.app).toBe("cumea");

    const pushToken = "ExpoPushToken[abcdefghijklmnop]";
    const registeredPush = await fetch(`${REMOTE_BASE}/api/mobile/push-token`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ token: pushToken, platform: "ios" }),
    });
    expect(registeredPush.status).toBe(200);
    expect(await registeredPush.json()).toEqual({ enabled: true, platform: "ios" });
    expect(await (await fetch(`${REMOTE_BASE}/api/mobile/push-token`, { headers: auth })).json()).toEqual({
      enabled: true,
      platform: "ios",
    });
    const localDevicesWithPush = await api("GET", "/api/devices");
    expect(localDevicesWithPush.body.devices).toContainEqual(expect.objectContaining({
      id: claimed.device.id,
      pushEnabled: true,
      pushPlatform: "ios",
    }));
    expect(JSON.stringify(localDevicesWithPush.body)).not.toContain(pushToken);
    expect((await fetch(`${REMOTE_BASE}/api/mobile/push-token`, { method: "DELETE", headers: auth })).status).toBe(200);
    expect(snapshot.capabilities).toEqual({ computerPreview: false });
    expect(snapshot.bots.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("resumeCursors");
    expect(JSON.stringify(snapshot)).not.toContain("modelSelection");
    expect(JSON.stringify(snapshot)).not.toContain("approvalPolicy");
    expect(JSON.stringify(snapshot)).not.toContain("configured");
    expect(JSON.stringify(snapshot)).not.toContain("autoSleep");

    const privateConfig = await fetch(`${REMOTE_BASE}/api/config`, { headers: auth });
    expect(privateConfig.status).toBe(403);
    const privateConfigWrite = await fetch(`${REMOTE_BASE}/api/config`, {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ box: { token: "tok_secret_value" } }),
    });
    expect(privateConfigWrite.status).toBe(403);
    const privateAcpProfiles = await fetch(`${REMOTE_BASE}/api/acp-profiles`, { headers: auth });
    expect(privateAcpProfiles.status).toBe(403);
    const eventStream = await openEventStream(auth);
    expect(await eventStream.next()).toEqual({ kind: "hello" });
    const localEventStream = await openEventStream({}, BASE);
    expect(await localEventStream.next()).toEqual({ kind: "hello" });
    // Config events are local-only. The next remote frame must be the bot
    // created after this update, with provider/session fields removed.
    expect((await api("PUT", "/api/config", { profile: { name: "Remote test host" } })).status).toBe(200);
    expect(await localEventStream.next()).toMatchObject({ kind: "config", profile: { name: "Remote test host" } });
    localEventStream.close();
    const remoteCreate = await fetch(`${REMOTE_BASE}/api/bots`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "Mobile helper", title: "Research", temporary: true, ttlMinutes: 60 }),
    });
    expect(remoteCreate.status).toBe(201);
    const remoteBot = ((await remoteCreate.json()) as any).bot;
    expect(remoteBot).toMatchObject({
      name: "Mobile helper",
      title: "Research",
      lifecycle: { kind: "temporary", expiresAt: expect.any(Number) },
    });
    for (const forbidden of ["modelSelection", "resumeCursors", "computer", "approvalPolicy"]) {
      expect(JSON.stringify(remoteBot)).not.toContain(forbidden);
    }
    const botEvent = await eventStream.next();
    expect(botEvent).toMatchObject({ kind: "bot", bot: { id: remoteBot.id, name: "Mobile helper" } });
    expect(JSON.stringify(botEvent)).not.toContain("modelSelection");
    expect(JSON.stringify(botEvent)).not.toContain("resumeCursors");
    eventStream.close();

    const hiddenRules = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/approval-rules`, { headers: auth });
    expect(hiddenRules.status).toBe(403);
    const revokeFromMobile = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/approval-rules/approval-forged`, {
      method: "DELETE",
      headers: auth,
    });
    expect(revokeFromMobile.status).toBe(403);
    const resolveEffectFromMobile = await fetch(`${REMOTE_BASE}/api/effects/effect-forged/resolve`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ resolution: "applied", note: "forged" }),
    });
    expect(resolveEffectFromMobile.status).toBe(403);

    const forbiddenCreate = await fetch(`${REMOTE_BASE}/api/bots`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ modelSelection: { instanceId: "ghost", model: "secret" } }),
    });
    expect(forbiddenCreate.status).toBe(403);

    const forbiddenPatch = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "Remote rename" }),
    });
    expect(forbiddenPatch.status).toBe(403);
    const unreadPatch = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ unread: true }),
    });
    expect(unreadPatch.status).toBe(200);
    expect(((await unreadPatch.json()) as any).bot).toMatchObject({ id: remoteBot.id, unread: true });
    const conversionStream = await openEventStream(auth);
    expect(await conversionStream.next()).toEqual({ kind: "hello" });
    const permanentPatch = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ temporary: false }),
    });
    expect(permanentPatch.status).toBe(200);
    expect(((await permanentPatch.json()) as any).bot.lifecycle).toBeUndefined();
    expect(await conversionStream.next()).toMatchObject({
      kind: "bot",
      bot: { id: remoteBot.id, lifecycle: null },
    });
    conversionStream.close();

    const localRoutine = await api("POST", "/api/routines", {
      botId: remoteBot.id,
      name: "Mobile-editable routine",
      prompt: "private routine task",
      schedule: { kind: "daily", time: "09:00", timezone: "Europe/Rome" },
    });
    expect(localRoutine.status).toBe(201);
    const remoteRoutineId = localRoutine.body.routine.id;
    const remoteWork = await fetch(`${REMOTE_BASE}/api/work`, { headers: auth });
    const remoteWorkspace = ((await remoteWork.json()) as any).workspace;
    expect(remoteWorkspace.routines).toContainEqual(expect.objectContaining({ id: remoteRoutineId, name: "Mobile-editable routine" }));
    expect(JSON.stringify(remoteWorkspace)).not.toContain("private routine task");

    const allowedRoutinePatch = await fetch(`${REMOTE_BASE}/api/routines/${remoteRoutineId}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated from mobile", prompt: "new private task", enabled: false }),
    });
    expect(allowedRoutinePatch.status).toBe(200);
    const safeRoutine = ((await allowedRoutinePatch.json()) as any).routine;
    expect(safeRoutine).toMatchObject({ id: remoteRoutineId, name: "Updated from mobile", enabled: false });
    expect(JSON.stringify(safeRoutine)).not.toContain("new private task");

    const forbiddenRoutinePatch = await fetch(`${REMOTE_BASE}/api/routines/${remoteRoutineId}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ botId: "another-bot", provider: "ghost", computer: "local" }),
    });
    expect(forbiddenRoutinePatch.status).toBe(400);

    const lossyRoutinePatch = await fetch(`${REMOTE_BASE}/api/routines/${remoteRoutineId}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ enabled: "false" }),
    });
    expect(lossyRoutinePatch.status).toBe(400);
    const oversizedRoutinePatch = await fetch(`${REMOTE_BASE}/api/routines/${remoteRoutineId}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "p".repeat(20_001) }),
    });
    expect(oversizedRoutinePatch.status).toBe(400);

    const remoteRunNow = await fetch(`${REMOTE_BASE}/api/routines/${remoteRoutineId}/run`, {
      method: "POST",
      headers: auth,
    });
    expect(remoteRunNow.status).toBe(409);

    const uploaded = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/attachments`, {
      method: "POST",
      headers: { ...auth, "content-type": "text/plain", "x-file-name": encodeURIComponent("mobile-note.txt") },
      body: "mobile attachment",
    });
    expect(uploaded.status).toBe(201);
    const attachment = ((await uploaded.json()) as any).attachment;
    expect(attachment).toMatchObject({ botId: remoteBot.id, name: "mobile-note.txt", size: 17 });
    expect(attachment.storedPath).toBeUndefined();

    const newestPage = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/messages?limit=1`, { headers: auth });
    expect(newestPage.status).toBe(200);
    const newest = (await newestPage.json()) as any;
    expect(newest.messages).toHaveLength(1);
    expect(newest.page).toMatchObject({ limit: 1, hasMore: true });
    const olderPage = await fetch(
      `${REMOTE_BASE}/api/bots/${remoteBot.id}/messages?limit=1&before=${encodeURIComponent(newest.page.nextBefore)}`,
      { headers: auth },
    );
    expect(olderPage.status).toBe(200);
    expect(((await olderPage.json()) as any).messages).toHaveLength(1);

    const remoteSend = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/messages`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ text: "Summarize this note", attachmentIds: [attachment.id] }),
    });
    expect(remoteSend.status).toBe(409);
    const sendError = (await remoteSend.json()) as any;
    expect(sendError.error).toBe("provider unavailable");
    expect(JSON.stringify(sendError)).not.toContain("ghost");
    const afterSend = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/messages?limit=1`, { headers: auth });
    expect(afterSend.status).toBe(200);
    expect(((await afterSend.json()) as any).messages[0]).toMatchObject({
      role: "user",
      text: "Summarize this note",
      attachments: [{ id: attachment.id, name: "mobile-note.txt" }],
    });

    const preview = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/computer-preview`, { headers: auth });
    expect(preview.status).toBe(403);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    expect(await preview.json()).toEqual({ error: "computer preview is disabled" });

    // Once attached to a task, the canonical delete endpoint must preserve
    // the audit trail and the file. A fresh upload remains fully reversible.
    const auditedDelete = await fetch(`${REMOTE_BASE}/api/attachments/${attachment.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(auditedDelete.status).toBe(409);
    const rollbackUpload = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/attachments`, {
      method: "POST",
      headers: { ...auth, "content-type": "text/plain", "x-file-name": encodeURIComponent("rollback.txt") },
      body: "delete me",
    });
    expect(rollbackUpload.status).toBe(201);
    const rollbackAttachment = ((await rollbackUpload.json()) as any).attachment;
    const rollbackPath = join(home, ".cumea", "attachments", remoteBot.id);
    expect(readFileSync(join(rollbackPath, readdirSync(rollbackPath).find((name) => name.endsWith("-rollback.txt"))!), "utf8")).toBe("delete me");
    const unauthenticatedDelete = await fetch(`${REMOTE_BASE}/api/attachments/${rollbackAttachment.id}`, { method: "DELETE" });
    expect(unauthenticatedDelete.status).toBe(401);
    const rollbackDelete = await fetch(`${REMOTE_BASE}/api/attachments/${rollbackAttachment.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(rollbackDelete.status).toBe(200);
    expect((await rollbackDelete.json()) as any).toEqual({ ok: true });
    const rollbackWork = await fetch(`${REMOTE_BASE}/api/work`, { headers: auth });
    expect(JSON.stringify(await rollbackWork.json())).not.toContain(rollbackAttachment.id);
    expect(readdirSync(rollbackPath).some((name) => name.endsWith("-rollback.txt"))).toBe(false);

    // The audited attachment is the one persistent record for this bot.
    // Fill the remaining count quota, then prove the canonical upload route
    // rejects further authenticated storage growth before accepting bytes.
    const quotaStatuses: number[] = [];
    for (let index = 0; index < ATTACHMENT_MAX_COUNT_PER_BOT - 1; index += 1) {
      let response: Response;
      try {
        response = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/attachments`, {
          method: "POST",
          headers: { ...auth, "content-type": "text/plain", "x-file-name": `quota-${index}.txt` },
          body: "x",
        });
      } catch (error) {
        throw new Error(`quota upload ${index} failed (server exit ${child.exitCode}): ${String(error)}\n${stderr}`);
      }
      quotaStatuses.push(response.status);
      await response.arrayBuffer();
    }
    expect(quotaStatuses.every((status) => status === 201), stderr).toBe(true);
    let quotaRejected: Response;
    try {
      quotaRejected = await fetch(`${REMOTE_BASE}/api/bots/${remoteBot.id}/attachments`, {
        method: "POST",
        headers: { ...auth, "content-type": "text/plain", "x-file-name": "over-quota.txt" },
        body: "x",
      });
    } catch (error) {
      throw new Error(`quota rejection failed (server exit ${child.exitCode}): ${String(error)}\n${stderr}`);
    }
    expect(quotaRejected.status).toBe(429);
    expect(await quotaRejected.json()).toEqual({ error: "attachment count quota reached (100 per bot)" });
    expect((await api("DELETE", `/api/bots/${remoteBot.id}`)).status).toBe(200);

    const devices = await api("GET", "/api/devices");
    expect(devices.body.devices).toContainEqual(expect.objectContaining({ id: claimed.device.id, name: "Test phone" }));
    const credentialFile = readFileSync(join(home, ".cumea", "mobile-devices.json"), "utf8");
    expect(credentialFile).not.toContain(claimed.token);
    expect(credentialFile).not.toContain(created.body.session.secret);

    expect((await api("DELETE", `/api/devices/${claimed.device.id}`)).status).toBe(200);
    expect((await fetch(`${REMOTE_BASE}/api/mobile/bootstrap`, { headers: auth })).status).toBe(401);
  }, 20_000);

  it("returns a bounded client error for malformed JSON", async () => {
    const res = await fetch(`${BASE}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON body" });
  });

  it("seeds one starter bot with its greeting", async () => {
    const { status, body } = await api("GET", "/api/bots");
    expect(status).toBe(200);
    expect(body.bots.length).toBeGreaterThanOrEqual(1);
    expect(body.bots[0].messages.length).toBeGreaterThanOrEqual(2);
  });

  it("starts an explicit clean context without cloning the agent", async () => {
    const created = await api("POST", "/api/bots", { name: "Context tester", title: "Research" });
    expect(created.status).toBe(201);
    const botId = created.body.bot.id as string;

    const started = await api("POST", `/api/bots/${botId}/contexts`, { label: "Sensitive market scan" });
    expect(started.status).toBe(201);
    expect(started.body.context).toMatchObject({ label: "Sensitive market scan", startedAt: expect.any(Number) });
    expect(started.body.message).toMatchObject({ role: "bot", kind: "context" });

    const refreshed = await api("GET", "/api/bots");
    const bot = refreshed.body.bots.find((candidate: { id: string }) => candidate.id === botId);
    expect(bot).toMatchObject({
      id: botId,
      context: { id: started.body.context.id, label: "Sensitive market scan" },
      resumeCursors: {},
    });
    expect(bot.messages.at(-1)).toMatchObject({ id: started.body.message.id, kind: "context" });

    expect((await api("DELETE", `/api/bots/${botId}`)).status).toBe(200);
  });

  it("describes the configured fleet, shadows included", async () => {
    const { status, body } = await api("GET", "/api/instances");
    expect(status).toBe(200);
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0]).toMatchObject({
      instanceId: "ghost",
      driverKind: "not-a-real-driver",
      displayName: "Ghost",
      snapshot: { state: "unavailable" },
      capabilities: { sessionModelSwitch: "unsupported" },
    });
    expect(body.instances[0].snapshot.reason).toContain("not-a-real-driver");
  });

  it("creates, patches, and deletes a bot", async () => {
    const created = await api("POST", "/api/bots", { temporary: true, ttlMinutes: 60 });
    expect(created.status).toBe(201);
    const bot = created.body.bot;
    expect(bot.lifecycle).toMatchObject({ kind: "temporary", expiresAt: expect.any(Number) });
    expect(bot.lifecycle.expiresAt).toBeGreaterThan(Date.now());
    expect((await api("POST", "/api/bots", { temporary: true, ttlMinutes: 5 })).status).toBe(400);
    expect((await api("POST", "/api/bots", { ttlMinutes: 60 })).status).toBe(400);

    const patched = await api("PATCH", `/api/bots/${bot.id}`, { name: "Renamed", pinned: true, temporary: false });
    expect(patched.status).toBe(200);
    expect(patched.body.bot).toMatchObject({ name: "Renamed", pinned: true });
    expect(patched.body.bot.lifecycle).toBeUndefined();

    const avatar = { kind: "mote", shapeId: "drop", color: "#f56a16", motion: "playful" };
    const avatarPatch = await api("PATCH", `/api/bots/${bot.id}`, { avatar });
    expect(avatarPatch.status).toBe(200);
    expect(avatarPatch.body.bot.avatar).toEqual(avatar);
    expect((await api("PATCH", `/api/bots/${bot.id}`, { avatar: { ...avatar, shapeId: "script" } })).status).toBe(400);

    const missing = await api("PATCH", "/api/bots/does-not-exist", { name: "x" });
    expect(missing.status).toBe(404);

    const routine = await api("POST", "/api/routines", {
      botId: bot.id,
      name: "Temporary schedule",
      prompt: "Create auditable work before deletion",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect(routine.status).toBe(201);
    // The ghost provider fails honestly but still creates task/run audit state,
    // which deletion must remove together with the schedule.
    expect((await api("POST", `/api/routines/${routine.body.routine.id}/run`)).status).toBe(409);

    const outputWorkspace = join(home, ".cumea", "bot-workspaces", bot.id);
    mkdirSync(outputWorkspace, { recursive: true });
    writeFileSync(join(outputWorkspace, "delete-me.md"), "private capability");
    const capability = await api("POST", `/api/bots/${bot.id}/files/resolve`, { path: "delete-me.md" });
    expect(capability.status).toBe(201);

    const deleted = await api("DELETE", `/api/bots/${bot.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.removed).toMatchObject({ tasks: 1, runs: 1, routines: 1 });
    expect(deleted.body.computerCleanup).toEqual({ outcome: "not-configured" });
    const after = await api("GET", "/api/bots");
    expect(after.body.bots.find((b: { id: string }) => b.id === bot.id)).toBeUndefined();
    const afterWork = (await api("GET", "/api/work")).body.workspace;
    expect(afterWork.routines.some((candidate: { botId: string }) => candidate.botId === bot.id)).toBe(false);
    expect(afterWork.tasks.some((candidate: { botId: string }) => candidate.botId === bot.id)).toBe(false);
    expect(afterWork.runs.some((candidate: { botId: string }) => candidate.botId === bot.id)).toBe(false);
    expect(existsSync(outputWorkspace)).toBe(false);
    expect((await fetch(`${BASE}${capability.body.file.previewUrl}`)).status).toBe(404);
  });

  it("keeps the bot and its routines when attachment cleanup blocks deletion", async () => {
    const created = await api("POST", "/api/bots");
    const bot = created.body.bot;
    const routine = await api("POST", "/api/routines", {
      botId: bot.id,
      name: "Must survive failed delete",
      prompt: "Remain scheduled until cleanup succeeds",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    const upload = await fetch(`${BASE}/api/bots/${bot.id}/attachments`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-file-name": "blocked.txt" },
      body: "temporary",
    });
    expect(upload.status).toBe(201);

    const attachmentDir = join(home, ".cumea", "attachments", bot.id);
    const attachmentPath = join(attachmentDir, readdirSync(attachmentDir)[0]);
    rmSync(attachmentPath);
    mkdirSync(attachmentPath);

    const failed = await api("DELETE", `/api/bots/${bot.id}`);
    expect(failed).toMatchObject({ status: 500, body: { error: "could not stage bot attachment blocked.txt" } });
    expect((await api("GET", "/api/bots")).body.bots).toContainEqual(expect.objectContaining({ id: bot.id, busy: false }));
    expect((await api("GET", "/api/work")).body.workspace.routines).toContainEqual(
      expect.objectContaining({ id: routine.body.routine.id, botId: bot.id }),
    );

    rmSync(attachmentPath, { recursive: true, force: true });
    expect((await api("DELETE", `/api/bots/${bot.id}`)).status).toBe(200);
  });

  it("drains admitted uploads and file resolves before publishing bot.deleted", async () => {
    const bot = (await api("POST", "/api/bots", { temporary: true, ttlMinutes: 60 })).body.bot;
    const routine = await api("POST", "/api/routines", {
      botId: bot.id,
      name: "Deletion-race fixture",
      prompt: "Create one auditable task before deletion",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect(routine.status).toBe(201);
    // The deliberately unavailable provider still leaves a canonical failed
    // task, which is enough to exercise the task/teach owner lookup.
    expect((await api("POST", `/api/routines/${routine.body.routine.id}/run`)).status).toBe(409);
    const task = (await api("GET", "/api/work")).body.workspace.tasks.find(
      (candidate: { routineId?: string }) => candidate.routineId === routine.body.routine.id,
    );
    expect(task).toBeDefined();
    const deletableUpload = await fetch(`${BASE}/api/bots/${bot.id}/attachments`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-file-name": "delete-during-race.txt" },
      body: "owned attachment",
    });
    expect(deletableUpload.status).toBe(201);
    const deletableAttachment = (await deletableUpload.json()) as { attachment: { id: string } };
    const botWorkspace = join(home, ".cumea", "bot-workspaces", bot.id);
    mkdirSync(botWorkspace, { recursive: true });
    writeFileSync(join(botWorkspace, "race.md"), "# Race-safe preview");

    // The 100-continue acknowledgement is sent from Node immediately before
    // it emits the request to our handler. By the time the client receives it,
    // both handlers have synchronously entered the per-bot gate and are paused
    // only on their deliberately withheld bodies.
    const upload = beginPausedRequest(
      `/api/bots/${bot.id}/attachments`,
      "late upload bytes",
      { "content-type": "text/plain", "x-file-name": "late.txt" },
    );
    const resolve = beginPausedRequest(
      `/api/bots/${bot.id}/files/resolve`,
      JSON.stringify({ path: "./race.md" }),
      { "content-type": "application/json" },
    );
    await Promise.all([upload.admitted, resolve.admitted]);

    const deletion = api("DELETE", `/api/bots/${bot.id}`);
    let blocked: { status: number; body: any } | undefined;
    const deadline = Date.now() + 2_000;
    do {
      blocked = await api("POST", `/api/bots/${bot.id}/files/resolve`, { path: "./race.md" });
      if (blocked.status === 409) break;
      await new Promise((done) => setTimeout(done, 5));
    } while (Date.now() < deadline);
    expect(blocked).toEqual({ status: 409, body: { error: "the bot is being deleted" } });

    // Once deletion closes admission, lifecycle conversion and every Box
    // action fail before reading or exposing provider data. The same gate also
    // covers the adjacent message/respond/interrupt/delete mutation paths.
    const blockedDuringDelete = await Promise.all([
      api("PATCH", `/api/bots/${bot.id}`, { temporary: false }),
      api("GET", `/api/bots/${bot.id}/computer`),
      api("POST", `/api/bots/${bot.id}/computer/provision`),
      api("POST", `/api/bots/${bot.id}/computer/join`),
      api("POST", `/api/bots/${bot.id}/computer/sleep`),
      api("POST", `/api/bots/${bot.id}/computer/exec`, { command: "pwd" }),
      api("POST", `/api/bots/${bot.id}/computer/screenshot`),
      api("POST", `/api/bots/${bot.id}/messages`, { text: "must not start" }),
      api("POST", `/api/bots/${bot.id}/respond`, { requestId: "late-request", behavior: "deny" }),
      api("POST", `/api/bots/${bot.id}/interrupt`),
      api("POST", "/api/routines", {
        botId: bot.id,
        name: "Must not be acknowledged",
        prompt: "Must not become an orphan",
        schedule: { kind: "interval", everyMinutes: 30 },
      }),
      api("POST", `/api/tasks/${task.id}/teach`, {
        name: "Must not be taught",
        schedule: { kind: "interval", everyMinutes: 30 },
      }),
      api("POST", `/api/tasks/${task.id}/retry`),
      api("PATCH", `/api/routines/${routine.body.routine.id}`, { enabled: false }),
      api("DELETE", `/api/routines/${routine.body.routine.id}`),
      api("POST", `/api/routines/${routine.body.routine.id}/run`),
      api("DELETE", `/api/attachments/${deletableAttachment.attachment.id}`),
      api("DELETE", `/api/bots/${bot.id}`),
    ]);
    for (const result of blockedDuringDelete) {
      expect(result.status).toBe(409);
      expect(result.body.error).toMatch(/delet/i);
    }

    upload.finish();
    resolve.finish();
    const [uploaded, resolved, deleted] = await Promise.all([upload.response, resolve.response, deletion]);
    expect(uploaded.status).toBe(201);
    expect(resolved.status).toBe(201);
    expect(deleted.status).toBe(200);

    const capabilityUrl = resolved.body.file.previewUrl as string;
    expect((await fetch(`${BASE}${capabilityUrl}`)).status).toBe(404);
    const attachmentDirectory = join(home, ".cumea", "attachments", bot.id);
    expect(existsSync(attachmentDirectory) ? readdirSync(attachmentDirectory) : []).toEqual([]);
    expect(existsSync(botWorkspace)).toBe(false);
    const afterWork = (await api("GET", "/api/work")).body.workspace;
    expect(afterWork.attachments.some((attachment: { botId: string }) => attachment.botId === bot.id)).toBe(false);
    expect(afterWork.routines.some((candidate: { botId: string }) => candidate.botId === bot.id)).toBe(false);
    expect(afterWork.tasks.some((candidate: { botId: string }) => candidate.botId === bot.id)).toBe(false);

    const lateUpload = await fetch(`${BASE}/api/bots/${bot.id}/attachments`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-file-name": "after-delete.txt" },
      body: "must not persist",
    });
    expect(lateUpload.status).toBe(404);
    expect(existsSync(attachmentDirectory) ? readdirSync(attachmentDirectory) : []).toEqual([]);
  });

  for (const target of [
    { label: "transcript", relative: (threadId: string) => `messages-${threadId}.json` },
    { label: "event log", relative: (threadId: string) => join("events", `${threadId}.ndjson`) },
    { label: "native log", relative: (threadId: string) => join("native", `${threadId}.ndjson`) },
  ]) {
    it(`keeps all records and restores prepared files when the ${target.label} path is blocked`, async () => {
      const created = await api("POST", "/api/bots");
      const bot = created.body.bot;
      const routine = await api("POST", "/api/routines", {
        botId: bot.id,
        name: `Survive blocked ${target.label}`,
        prompt: "Remain scheduled until deletion can complete",
        schedule: { kind: "interval", everyMinutes: 30 },
      });
      expect(routine.status).toBe(201);

      const transcript = join(home, ".cumea", `messages-${bot.threadId}.json`);
      const transcriptBefore = readFileSync(transcript, "utf8");
      const blockedPath = join(home, ".cumea", target.relative(bot.threadId));
      rmSync(blockedPath, { recursive: true, force: true });
      mkdirSync(blockedPath, { recursive: true });

      const failed = await api("DELETE", `/api/bots/${bot.id}`);
      expect(failed).toMatchObject({ status: 500, body: { error: `could not stage bot ${target.label}` } });
      expect((await api("GET", "/api/bots")).body.bots).toContainEqual(expect.objectContaining({ id: bot.id }));
      expect((await api("GET", "/api/work")).body.workspace.routines).toContainEqual(
        expect.objectContaining({ id: routine.body.routine.id, botId: bot.id }),
      );
      expect(existsSync(blockedPath)).toBe(true);
      if (target.label !== "transcript") {
        expect(readFileSync(transcript, "utf8")).toBe(transcriptBefore);
      }

      rmSync(blockedPath, { recursive: true, force: true });
      expect((await api("DELETE", `/api/bots/${bot.id}`)).status).toBe(200);
    });
  }

  it("organizes bots in persistent sections and validates per-bot capabilities", async () => {
    const bot = (await api("GET", "/api/bots")).body.bots[0];
    const created = await api("POST", "/api/sections", { name: "Operations" });
    expect(created.status).toBe(201);

    const patched = await api("PATCH", `/api/bots/${bot.id}`, {
      sectionId: created.body.section.id,
      appsEnabled: false,
      collaborationEnabled: false,
    });
    expect(patched.body.bot).toMatchObject({
      sectionId: created.body.section.id,
      appsEnabled: false,
      collaborationEnabled: false,
    });

    const renamed = await api("PATCH", `/api/sections/${created.body.section.id}`, { name: "Back office" });
    expect(renamed.body.section.name).toBe("Back office");
    const work = await api("GET", "/api/work");
    expect(work.body.workspace.sections).toContainEqual(renamed.body.section);

    expect(await api("PATCH", `/api/bots/${bot.id}`, { approvalPolicy: "allow" })).toMatchObject({
      status: 400,
      body: { error: "global approval policies are no longer supported" },
    });
    expect((await api("PATCH", `/api/bots/${bot.id}`, { coordinator: "yes" })).status).toBe(400);
    expect(await api("PATCH", `/api/bots/${bot.id}`, { coordinator: true })).toMatchObject({
      status: 400,
      body: { error: "the selected provider does not support Coordinator peer tools" },
    });

    const forgedRemember = await api("POST", `/api/bots/${bot.id}/respond`, {
      requestId: "not-a-pending-request",
      behavior: "allow",
      rememberPolicy: "allow",
    });
    expect(forgedRemember).toMatchObject({ status: 409, body: { error: "no such pending request" } });
    const afterForgedRemember = (await api("GET", "/api/bots")).body.bots.find(
      (candidate: any) => candidate.id === bot.id,
    );
    expect(afterForgedRemember).not.toHaveProperty("approvalPolicy");
    expect(await api("GET", `/api/bots/${bot.id}/approval-rules`)).toMatchObject({
      status: 200,
      body: { rules: [] },
    });
    expect((await api("DELETE", `/api/bots/${bot.id}/approval-rules/approval-missing`)).status).toBe(404);

    expect((await api("DELETE", `/api/sections/${created.body.section.id}`)).status).toBe(200);
    const after = (await api("GET", "/api/bots")).body.bots.find((candidate: any) => candidate.id === bot.id);
    expect(after.sectionId).toBeNull();
  });

  it("manages local MCP servers with write-only secrets and explicit per-agent assignment", async () => {
    const secret = "mcp-secret-must-never-be-projected";
    const created = await api("POST", "/api/mcp-servers", {
      name: "Private research tools",
      command: "/usr/local/bin/private-mcp",
      args: ["--stdio"],
      environment: { PRIVATE_TOKEN: secret },
    });
    expect(created.status).toBe(201);
    expect(created.body.server).toMatchObject({
      name: "Private research tools",
      command: "/usr/local/bin/private-mcp",
      args: ["--stdio"],
      environmentKeys: ["PRIVATE_TOKEN"],
      enabled: true,
    });
    expect(JSON.stringify(created.body)).not.toContain(secret);

    const listed = await api("GET", "/api/mcp-servers");
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    expect(listed.body.servers).toContainEqual(expect.objectContaining({ id: created.body.server.id }));

    const bot = (await api("GET", "/api/bots")).body.bots[0];
    const assigned = await api("PATCH", `/api/bots/${bot.id}`, { mcpServerIds: [created.body.server.id] });
    expect(assigned.status).toBe(200);
    expect(assigned.body.bot.mcpServerIds).toEqual([created.body.server.id]);
    expect((await api("DELETE", `/api/mcp-servers/${created.body.server.id}`))).toMatchObject({
      status: 409,
      body: { error: "Unassign this MCP server from every agent before deleting it." },
    });

    expect((await api("PATCH", `/api/bots/${bot.id}`, { mcpServerIds: [] })).status).toBe(200);
    expect((await api("DELETE", `/api/mcp-servers/${created.body.server.id}`)).status).toBe(200);
  });

  it("keeps revisioned agent memory local, concurrency-safe, and deleted with its owner", async () => {
    const bot = (await api("POST", "/api/bots", { name: "Memory tester" })).body.bot;
    const created = await api("POST", `/api/bots/${bot.id}/memories`, {
      path: "preferences",
      content: "Prefer concise Italian with source-backed claims.",
      pinned: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.document).toMatchObject({ path: "preferences.md", revision: 1, pinned: true });

    const updated = await api("PUT", `/api/bots/${bot.id}/memories/${created.body.document.id}`, {
      expectedRevision: 1,
      content: "Prefer concise Italian with exact verification evidence.",
    });
    expect(updated.body.document).toMatchObject({ revision: 2, provenance: { source: "user", threadId: bot.threadId } });
    expect((await api("PUT", `/api/bots/${bot.id}/memories/${created.body.document.id}`, {
      expectedRevision: 1,
      content: "stale overwrite",
    })).status).toBe(409);

    const revisions = await api("GET", `/api/bots/${bot.id}/memories/${created.body.document.id}/revisions`);
    expect(revisions.body.revisions.map((revision: any) => revision.revision)).toEqual([2, 1]);
    expect((await api("POST", `/api/bots/${bot.id}/memories`, {
      path: "credentials",
      content: `sk-${"a".repeat(24)}`,
    })).status).toBe(400);

    const file = join(home, ".cumea", `memory-${bot.id}.json`);
    expect(existsSync(file)).toBe(true);
    expect((await api("DELETE", `/api/bots/${bot.id}`)).status).toBe(200);
    expect(existsSync(file)).toBe(false);
  });

  it("uploads, downloads, and removes bot attachments without exposing their disk path", async () => {
    const bot = (await api("GET", "/api/bots")).body.bots[0];
    const upload = await fetch(`${BASE}/api/bots/${bot.id}/attachments`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-file-name": encodeURIComponent("../notes.txt") },
      body: "private test note",
    });
    expect(upload.status).toBe(201);
    const attachment = ((await upload.json()) as any).attachment;
    expect(attachment).toMatchObject({ name: "notes.txt", mime: "text/plain", size: 17, botId: bot.id });
    expect(attachment.storedPath).toBeUndefined();

    const download = await fetch(`${BASE}/api/attachments/${attachment.id}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("private test note");
    const work = await api("GET", "/api/work");
    expect(JSON.stringify(work.body)).not.toContain(home);

    expect((await api("DELETE", `/api/attachments/${attachment.id}`)).status).toBe(200);
    expect((await api("GET", `/api/attachments/${attachment.id}`)).status).toBe(404);
  });

  it("opens bot and attachment documents through opaque, same-origin capabilities", async () => {
    const bot = (await api("GET", "/api/bots")).body.bots[0];
    const botWorkspace = join(home, ".cumea", "bot-workspaces", bot.id);
    mkdirSync(botWorkspace, { recursive: true });
    writeFileSync(join(botWorkspace, "brief.md"), "# Private brief\n\nSafe text");

    const resolved = await api("POST", `/api/bots/${bot.id}/files/resolve`, { path: "./brief.md" });
    expect(resolved.status).toBe(201);
    expect(resolved.body.file).toMatchObject({ name: "brief.md", kind: "markdown", source: "local" });
    expect(resolved.body.file.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(resolved.body)).not.toContain(home);

    const preview = await fetch(`${BASE}${resolved.body.file.previewUrl}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    expect(await preview.json()).toEqual({ preview: { kind: "markdown", text: "# Private brief\n\nSafe text" } });

    const hostileHtml = [
      "<!doctype html><html><head>",
      '</head><body><form action="https://attacker.invalid/form"><button>Send</button></form>',
      '<script>fetch("https://attacker.invalid/script")</script>',
      '<img src="https://attacker.invalid/pixel">',
      '<a href="https://attacker.invalid/nav">Leave</a>',
      "</body></html>",
    ].join("");
    writeFileSync(join(botWorkspace, "artifact.html"), hostileHtml);
    const htmlResolved = await api("POST", `/api/bots/${bot.id}/files/resolve`, { path: "artifact.html" });
    expect(htmlResolved.status).toBe(201);
    expect(htmlResolved.body.file).toMatchObject({ kind: "html", mime: "text/html; charset=utf-8" });
    const htmlPreview = await fetch(`${BASE}${htmlResolved.body.file.previewUrl}`);
    expect(htmlPreview.status).toBe(200);
    expect(htmlPreview.headers.get("cache-control")).toBe("no-store");
    expect(htmlPreview.headers.get("content-type")).toContain("text/html");
    expect(htmlPreview.headers.get("content-disposition")).toContain("inline;");
    expect(htmlPreview.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(htmlPreview.headers.get("x-content-type-options")).toBe("nosniff");
    expect(htmlPreview.headers.get("referrer-policy")).toBe("no-referrer");
    expect(htmlPreview.headers.get("permissions-policy")).toContain("camera=()");
    const htmlCsp = htmlPreview.headers.get("content-security-policy") ?? "";
    for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "form-action 'none'", "navigate-to 'none'", "sandbox", "frame-ancestors 'self'"]) {
      expect(htmlCsp).toContain(directive);
    }
    expect(await htmlPreview.text()).toBe(hostileHtml);
    const htmlDownload = await fetch(`${BASE}${htmlResolved.body.file.downloadUrl}`);
    expect(htmlDownload.headers.get("content-type")).toContain("application/octet-stream");
    expect(htmlDownload.headers.get("content-disposition")).toContain("attachment;");
    expect(await htmlDownload.text()).toBe(hostileHtml);

    const download = await fetch(`${BASE}${resolved.body.file.downloadUrl}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(await download.text()).toBe("# Private brief\n\nSafe text");

    const outside = await api("POST", `/api/bots/${bot.id}/files/resolve`, { path: "../../config.json" });
    expect(outside.status).toBe(403);
    expect(JSON.stringify(outside.body)).not.toContain(home);

    writeFileSync(join(botWorkspace, "paper.pdf"), "%PDF-1.7\n1 0 obj\n%%EOF");
    const pdfResolved = await api("POST", `/api/bots/${bot.id}/files/resolve`, { path: "paper.pdf" });
    expect(pdfResolved.status).toBe(201);
    const pdfPreview = await fetch(`${BASE}${pdfResolved.body.file.previewUrl}`);
    expect(pdfPreview.headers.get("x-frame-options")).toBe("DENY");
    expect(pdfPreview.headers.get("content-security-policy")).toBeNull();
    expect(pdfPreview.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pdfPreview.headers.get("referrer-policy")).toBe("no-referrer");
    expect(pdfPreview.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(pdfPreview.headers.get("content-type")).toContain("application/pdf");
    expect(pdfPreview.headers.get("content-disposition")).toContain("attachment;");
    expect(await pdfPreview.text()).toBe("%PDF-1.7\n1 0 obj\n%%EOF");

    const upload = await fetch(`${BASE}/api/bots/${bot.id}/attachments`, {
      method: "POST",
      headers: { "content-type": "text/markdown", "x-file-name": encodeURIComponent("uploaded.md") },
      body: "## Uploaded",
    });
    const attachment = ((await upload.json()) as any).attachment;
    const attachmentResolved = await api("POST", `/api/attachments/${attachment.id}/files/resolve`);
    expect(attachmentResolved.status).toBe(201);
    expect(attachmentResolved.body.file).toMatchObject({ name: "uploaded.md", kind: "markdown" });
    const attachmentPreview = await fetch(`${BASE}${attachmentResolved.body.file.previewUrl}`);
    expect(await attachmentPreview.json()).toEqual({ preview: { kind: "markdown", text: "## Uploaded" } });
    await api("DELETE", `/api/attachments/${attachment.id}`);

    const htmlUpload = await fetch(`${BASE}/api/bots/${bot.id}/attachments`, {
      method: "POST",
      headers: { "content-type": "text/html", "x-file-name": encodeURIComponent("untrusted-upload.html") },
      body: "<!doctype html><html><body>Uploaded</body></html>",
    });
    expect(htmlUpload.status).toBe(201);
    const htmlAttachment = ((await htmlUpload.json()) as any).attachment;
    const htmlAttachmentPreview = await api("POST", `/api/attachments/${htmlAttachment.id}/files/resolve`);
    expect(htmlAttachmentPreview).toEqual({
      status: 415,
      body: { error: "HTML preview is limited to generated workspace artifacts" },
    });
    const htmlAttachmentDownload = await fetch(`${BASE}/api/attachments/${htmlAttachment.id}`);
    expect(htmlAttachmentDownload.headers.get("content-disposition")).toContain("attachment;");
    expect(await htmlAttachmentDownload.text()).toContain("Uploaded");
    await api("DELETE", `/api/attachments/${htmlAttachment.id}`);
  });

  it("creates, pauses, runs, and deletes a persistent routine", async () => {
    const bot = (await api("GET", "/api/bots")).body.bots[0];
    const created = await api("POST", "/api/routines", {
      botId: bot.id,
      name: "Inbox pass",
      prompt: "Triage the inbox and leave drafts",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect(created.status).toBe(201);
    expect(created.body.routine.nextRunAt).toBeGreaterThan(Date.now());

    const paused = await api("PATCH", `/api/routines/${created.body.routine.id}`, { enabled: false });
    expect(paused.body.routine).toMatchObject({ enabled: false, nextRunAt: null });

    // The fixture intentionally has only an unavailable provider. Run-now
    // must report that truth and keep an auditable failed routine result.
    const run = await api("POST", `/api/routines/${created.body.routine.id}/run`);
    expect(run.status).toBe(409);
    const work = await api("GET", "/api/work");
    expect(work.body.workspace.routines.find((routine: any) => routine.id === created.body.routine.id)).toMatchObject({
      lastStatus: "failed",
    });

    expect((await api("DELETE", `/api/routines/${created.body.routine.id}`)).status).toBe(200);
  });

  it("administers acceptance evidence locally without treating completion as verification", async () => {
    const bot = (await api("GET", "/api/bots")).body.bots[0];
    const routine = await api("POST", "/api/routines", {
      botId: bot.id,
      name: "Evidence fixture",
      prompt: "Create an auditable failed run",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    expect((await api("POST", `/api/routines/${routine.body.routine.id}/run`)).status).toBe(409);
    const initial = await api("GET", "/api/work");
    const task = initial.body.workspace.tasks.find((candidate: any) => candidate.routineId === routine.body.routine.id);
    expect(task.verificationStatus).toBe("not_required");

    const created = await api("POST", `/api/tasks/${task.id}/evidence-requirements`, { label: "A canonical result exists" });
    expect(created).toMatchObject({ status: 201, body: { verificationStatus: "pending" } });
    expect((await api("POST", `/api/tasks/${task.id}/evidence-requirements`, { label: "x".repeat(501) })).status).toBe(400);
    expect((await api("POST", `/api/tasks/${task.id}/evidence`, {
      requirementId: created.body.requirement.id,
      runId: task.latestRunId,
      reference: { kind: "step", id: "not-owned" },
    })).status).toBe(404);

    const after = await api("GET", "/api/work");
    expect(after.body.workspace.tasks.find((candidate: any) => candidate.id === task.id)).toMatchObject({
      status: "failed",
      verificationStatus: "pending",
      evidenceRequirements: [{ id: created.body.requirement.id, label: "A canonical result exists" }],
    });
    expect((await api("DELETE", `/api/tasks/${task.id}/evidence-requirements/${created.body.requirement.id}`)).status).toBe(200);
    await api("DELETE", `/api/routines/${routine.body.routine.id}`);
  });

  it("validates and persists provider-neutral task budgets without coercion", async () => {
    const bot = (await api("GET", "/api/bots")).body.bots[0];
    for (const budget of [{ toolCalls: "2" }, { durationMs: true }, { tokens: 1.5 }, { unknown: 1 }, {}]) {
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Invalid budget", budget })).status).toBe(400);
    }
    const result = await api("POST", `/api/bots/${bot.id}/messages`, {
      text: "Bound this task",
      budget: { durationMs: 60_000, toolCalls: 4, computerActions: 2, delegations: 1, tokens: 10_000 },
    });
    expect(result.status).toBe(409);
    const work = await api("GET", "/api/work");
    expect(work.body.workspace.tasks.find((task: any) => task.prompt === "Bound this task")).toMatchObject({
      budget: { durationMs: 60_000, toolCalls: 4, computerActions: 2, delegations: 1, tokens: 10_000 },
      status: "failed",
    });
  });

  it("rejects lossy routine coercions, oversized text, and invalid occurrence queries", async () => {
    const bot = (await api("GET", "/api/bots")).body.bots[0];
    expect((await api("POST", "/api/routines", {
      botId: bot.id,
      name: "String boolean",
      prompt: "Must stay disabled",
      schedule: { kind: "interval", everyMinutes: 30 },
      enabled: "false",
    })).status).toBe(400);
    expect((await api("POST", "/api/routines", {
      botId: bot.id,
      name: "String interval",
      prompt: "Do not coerce this",
      schedule: { kind: "interval", everyMinutes: "30" },
    })).status).toBe(400);

    const created = await api("POST", "/api/routines", {
      botId: bot.id,
      name: "Strict patch fixture",
      prompt: "Keep the original task",
      schedule: { kind: "daily", time: "09:00", timezone: "Europe/Rome" },
      enabled: false,
    });
    expect(created.status).toBe(201);
    const routineId = created.body.routine.id;
    expect((await api("PATCH", `/api/routines/${routineId}`, { enabled: "false" })).status).toBe(400);
    expect((await api("PATCH", `/api/routines/${routineId}`, { name: 123 })).status).toBe(400);
    expect((await api("PATCH", `/api/routines/${routineId}`, { prompt: "p".repeat(20_001) })).status).toBe(400);
    expect((await api("PATCH", `/api/routines/${routineId}`, {})).status).toBe(400);
    expect((await api("GET", "/api/work")).body.workspace.routines.find((routine: any) => routine.id === routineId)).toMatchObject({
      name: "Strict patch fixture",
      enabled: false,
    });

    const invalidQueries = [
      "from=NaN",
      "from=8640000000000001&to=8640000000000001",
      "limit=0",
      "limit=513",
      "limit=1.5",
      "from=100&to=99",
      `from=0&to=${31 * 24 * 60 * 60_000 + 1}`,
    ];
    for (const query of invalidQueries) {
      expect((await api("GET", `/api/routines/occurrences?${query}`)).status, query).toBe(400);
    }
    expect((await api("DELETE", `/api/routines/${routineId}`)).status).toBe(200);
  });

  it("persists an answered onboarding card", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];
    const card = bot.messages.find((m: { kind: string }) => m.kind === "options");
    const res = await api("PATCH", `/api/bots/${bot.id}/cards/${card.id}`, { answered: card.card.options[0] });
    expect(res.status).toBe(200);
    expect(res.body.message.card.answered).toBe(card.card.options[0]);
  });

  it("rejects an empty message and explains an unavailable provider", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];

    const empty = await api("POST", `/api/bots/${bot.id}/messages`, { text: "   " });
    expect(empty.status).toBe(400);

    // the seeded bot's selection points at the ghost instance — sending a
    // real message must fail loudly, not 202-and-hang
    const send = await api("POST", `/api/bots/${bot.id}/messages`, { text: "hello?" });
    expect(send.status).toBe(409);
    expect(send.body.error).toContain("unavailable");
  });

  it("keeps retrying a failed task auditable and fails honestly when its provider is unavailable", async () => {
    const bot = (await api("GET", "/api/bots")).body.bots[0];
    const routine = await api("POST", "/api/routines", {
      botId: bot.id,
      name: "Retry fixture",
      prompt: "Try this later",
      schedule: { kind: "interval", everyMinutes: 30 },
    });
    await api("POST", `/api/routines/${routine.body.routine.id}/run`);
    const work = await api("GET", "/api/work");
    const task = work.body.workspace.tasks.find((candidate: any) => candidate.routineId === routine.body.routine.id);
    expect(task.status).toBe("failed");

    const retried = await api("POST", `/api/tasks/${task.id}/retry`);
    expect(retried.status).toBe(409);
    const after = await api("GET", "/api/work");
    expect(after.body.workspace.runs.filter((run: any) => run.taskId === task.id)).toHaveLength(2);
    await api("DELETE", `/api/routines/${routine.body.routine.id}`);
  });

  it("saves config keys write-only and reports booleans", async () => {
    const before = await api("GET", "/api/config");
    expect(before.body.box).toEqual({ configured: false });

    const put = await api("PUT", "/api/config", { box: { token: "tok_secret_value" } });
    expect(put.status).toBe(200);
    expect(put.body.box).toEqual({ configured: true });
    expect(JSON.stringify(put.body)).not.toContain("tok_secret_value");

    const after = await api("GET", "/api/config");
    expect(after.body.box).toEqual({ configured: true });
    expect(JSON.stringify(after.body)).not.toContain("tok_secret_value");

    const rejected = await api("PUT", "/api/config", { box: { token: "box_rejected_secret" } });
    expect(rejected.status).toBe(401);
    expect(rejected.body).toMatchObject({ code: "invalid-credential" });
    expect(JSON.stringify(rejected.body)).not.toContain("box_rejected_secret");
    expect(JSON.stringify(rejected.body)).not.toContain("fixture body must stay private");

    const preserved = await api("GET", "/api/config");
    expect(preserved.body.box).toEqual({ configured: true });
    expect(JSON.parse(readFileSync(join(home, ".cumea", "config.json"), "utf8")).box.token).toBe("tok_secret_value");

    const disabled = await api("PATCH", "/api/config", { box: { autoSleepMinutes: false } });
    expect(disabled.status).toBe(200);
    expect(disabled.body.box).toEqual({ configured: true });
    expect(JSON.parse(readFileSync(join(home, ".cumea", "config.json"), "utf8")).box).toEqual({
      token: "tok_secret_value",
      autoSleepMinutes: false,
    });
    const configured = await api("PATCH", "/api/config", { box: { autoSleepMinutes: 30 } });
    expect(configured.status).toBe(200);
    for (const invalid of [0, 1441, "10"]) {
      expect((await api("PATCH", "/api/config", { box: { autoSleepMinutes: invalid } })).status).toBe(400);
    }
    const diskBox = JSON.parse(readFileSync(join(home, ".cumea", "config.json"), "utf8")).box;
    expect(diskBox).toEqual({ token: "tok_secret_value", autoSleepMinutes: 30 });

    const bot = (await api("GET", "/api/bots")).body.bots[0];
    expect((await api("PATCH", `/api/bots/${bot.id}`, { computer: "cloud" })).status).toBe(200);
    const localComputer = await api("GET", `/api/bots/${bot.id}/computer`);
    expect(localComputer.status).toBe(200);
    expect(localComputer.body.autoSleep).toMatchObject({ enabled: true, idleMs: 30 * 60_000 });

    const session = await api("POST", "/api/pairing/sessions", { ttlMs: 60_000 });
    const claimed = await (await fetch(`${REMOTE_BASE}/api/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.body.session.id, secret: session.body.session.secret, deviceName: "Idle policy test" }),
    })).json() as any;
    const remoteComputer = await fetch(`${REMOTE_BASE}/api/bots/${bot.id}/computer`, {
      headers: { authorization: `Bearer ${claimed.token}` },
    });
    expect(remoteComputer.status).toBe(403);
    expect(await remoteComputer.text()).not.toContain("autoSleep");

    const nothing = await api("PUT", "/api/config", {});
    expect(nothing.status).toBe(400);
  });

  it("stores and echoes the user profile (not write-only, unlike keys)", async () => {
    const put = await api("PUT", "/api/config", { profile: { name: "Ada Lovelace", email: "Ada@Example.com" } });
    expect(put.status).toBe(200);
    expect(put.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });

    const after = await api("GET", "/api/config");
    expect(after.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });
  });

  it("manages local ACP subscription profiles and protects profiles selected by a bot", async () => {
    const created = await api("POST", "/api/acp-profiles", {
      label: "Test subscription",
      executable: "definitely-not-installed-acp-agent",
      arguments: ["agent", "stdio", "--model", "{model}"],
      versionArguments: ["--version"],
      models: [
        { id: "fast", label: "Fast" },
        { id: "deep", label: "Deep" },
      ],
      defaultModel: "fast",
      requireAuthentication: false,
      fullAuto: false,
      enabled: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.profile).toMatchObject({ label: "Test subscription", defaultModel: "fast" });
    const profileId = created.body.profile.id;

    const listed = await api("GET", "/api/acp-profiles");
    expect(listed.body.profiles).toContainEqual(expect.objectContaining({ id: profileId, models: expect.any(Array) }));
    const instances = await api("GET", "/api/instances");
    expect(instances.body.instances).toContainEqual(expect.objectContaining({
      instanceId: profileId,
      driverKind: "customAcp",
      models: expect.objectContaining({ default: "fast" }),
    }));
    expect((await api("GET", "/api/config")).body.acpProfiles).toEqual({ count: 1 });

    const bot = (await api("GET", "/api/bots")).body.bots[0];
    expect((await api("PATCH", `/api/bots/${bot.id}`, {
      modelSelection: { instanceId: profileId, model: "fast" },
    })).status).toBe(200);
    const inUse = await api("DELETE", `/api/acp-profiles/${profileId}`);
    expect(inUse.status).toBe(409);

    expect((await api("PATCH", `/api/bots/${bot.id}`, {
      modelSelection: { instanceId: "ghost", model: "ghost-model" },
    })).status).toBe(200);
    expect((await api("DELETE", `/api/acp-profiles/${profileId}`)).status).toBe(200);
    expect((await api("GET", "/api/acp-profiles")).body.profiles).toEqual([]);
  });

  it("404s unknown routes with the route in the error", async () => {
    const res = await api("GET", "/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("/api/definitely-not-a-route");
  });

  it("keeps local skill administration desktop-only with strict bodies and explicit rollback", async () => {
    const id = `http-skill-${Date.now()}`;
    const bot = (await api("POST", "/api/bots", { name: "Skill owner" })).body.bot;
    const version = (value: string) => ({ id, displayName: "HTTP skill", description: "Test workflow", version: value, instructions: `Instructions ${value}`, label: "HTTP test", enabled: true });
    expect((await api("POST", "/api/skills", version("1.0.0"))).status).toBe(201);
    expect((await api("POST", `/api/skills/${id}/versions`, version("2.0.0"))).status).toBe(201);

    const malformed = await fetch(`${BASE}/api/skills/${id}/versions`, { method: "POST", headers: { "content-type": "application/json" }, body: "null" });
    expect(malformed.status).toBe(400);
    expect((await api("PATCH", `/api/skills/${id}/2.0.0`, [])).status).toBe(400);
    expect((await api("PUT", `/api/bots/${bot.id}/skills/${id}`, [])).status).toBe(400);
    expect((await fetch(`${REMOTE_BASE}/api/skills`)).status).toBe(401);
    const session = await api("POST", "/api/pairing/sessions", { ttlMs: 60_000 });
    const claimed = await (await fetch(`${REMOTE_BASE}/api/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.body.session.id, secret: session.body.session.secret, deviceName: "Skill privacy test" }),
    })).json() as any;
    const remoteAuth = { authorization: `Bearer ${claimed.token}`, "content-type": "application/json" };
    expect((await fetch(`${REMOTE_BASE}/api/skills`, { headers: remoteAuth })).status).toBe(403);
    expect((await fetch(`${REMOTE_BASE}/api/bots/${bot.id}/skills/${id}`, { method: "PUT", headers: remoteAuth, body: JSON.stringify({ version: "2.0.0" }) })).status).toBe(403);

    expect((await api("PUT", `/api/bots/${bot.id}/skills/${id}`, { version: "2.0.0" })).status).toBe(200);
    expect((await api("POST", `/api/bots/${bot.id}/skills/${id}/rollback`, { version: "1.0.0" })).status).toBe(200);
    expect((await api("POST", `/api/bots/${bot.id}/skills/${id}/rollback`, { version: "2.0.0" })).status).toBe(409);
    expect((await api("DELETE", `/api/skills/${id}/1.0.0`)).status).toBe(409);
    expect((await api("DELETE", `/api/bots/${bot.id}/skills/${id}`)).status).toBe(200);
    expect((await api("DELETE", `/api/skills/${id}/1.0.0`)).status).toBe(200);
  });
});
