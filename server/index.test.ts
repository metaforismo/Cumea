// API smoke test: boots the real harness server (node server/index.ts)
// against a throwaway home directory and exercises the HTTP surface the
// app depends on. The config pins one deliberately-unknown driver so the
// suite is deterministic with or without agent CLIs installed — and pins
// the shadow-instance behavior end to end while it's at it.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

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

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cumea-api-test-"));
  // a fleet of exactly one unknown driver: no CLI probes, no network
  mkdirSync(join(home, ".cumea"), { recursive: true });
  writeFileSync(
    join(home, ".cumea", "config.json"),
    JSON.stringify({ instances: { ghost: { driver: "not-a-real-driver", displayName: "Ghost" } } }),
  );

  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      CUMEA_PORT: String(PORT),
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
    expect(snapshot.capabilities).toEqual({ computerPreview: false });
    expect(snapshot.bots.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("resumeCursors");
    expect(JSON.stringify(snapshot)).not.toContain("modelSelection");
    expect(JSON.stringify(snapshot)).not.toContain("approvalPolicy");
    expect(JSON.stringify(snapshot)).not.toContain("configured");

    const privateConfig = await fetch(`${REMOTE_BASE}/api/config`, { headers: auth });
    expect(privateConfig.status).toBe(403);
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
      body: JSON.stringify({ name: "Mobile helper", title: "Research" }),
    });
    expect(remoteCreate.status).toBe(201);
    const remoteBot = ((await remoteCreate.json()) as any).bot;
    expect(remoteBot).toMatchObject({ name: "Mobile helper", title: "Research" });
    for (const forbidden of ["modelSelection", "resumeCursors", "computer", "approvalPolicy"]) {
      expect(JSON.stringify(remoteBot)).not.toContain(forbidden);
    }
    const botEvent = await eventStream.next();
    expect(botEvent).toMatchObject({ kind: "bot", bot: { id: remoteBot.id, name: "Mobile helper" } });
    expect(JSON.stringify(botEvent)).not.toContain("modelSelection");
    expect(JSON.stringify(botEvent)).not.toContain("resumeCursors");
    eventStream.close();

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
    const created = await api("POST", "/api/bots");
    expect(created.status).toBe(201);
    const bot = created.body.bot;

    const patched = await api("PATCH", `/api/bots/${bot.id}`, { name: "Renamed", pinned: true });
    expect(patched.status).toBe(200);
    expect(patched.body.bot).toMatchObject({ name: "Renamed", pinned: true });

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

    const deleted = await api("DELETE", `/api/bots/${bot.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.removed).toMatchObject({ tasks: 1, runs: 1, routines: 1 });
    const after = await api("GET", "/api/bots");
    expect(after.body.bots.find((b: { id: string }) => b.id === bot.id)).toBeUndefined();
    const afterWork = (await api("GET", "/api/work")).body.workspace;
    expect(afterWork.routines.some((candidate: { botId: string }) => candidate.botId === bot.id)).toBe(false);
    expect(afterWork.tasks.some((candidate: { botId: string }) => candidate.botId === bot.id)).toBe(false);
    expect(afterWork.runs.some((candidate: { botId: string }) => candidate.botId === bot.id)).toBe(false);
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
      approvalPolicy: "deny",
    });
    expect(patched.body.bot).toMatchObject({
      sectionId: created.body.section.id,
      appsEnabled: false,
      collaborationEnabled: false,
      approvalPolicy: "deny",
    });

    const renamed = await api("PATCH", `/api/sections/${created.body.section.id}`, { name: "Back office" });
    expect(renamed.body.section.name).toBe("Back office");
    const work = await api("GET", "/api/work");
    expect(work.body.workspace.sections).toContainEqual(renamed.body.section);

    expect((await api("PATCH", `/api/bots/${bot.id}`, { approvalPolicy: "everything" })).status).toBe(400);

    const forgedRemember = await api("POST", `/api/bots/${bot.id}/respond`, {
      requestId: "not-a-pending-request",
      behavior: "allow",
      rememberPolicy: "allow",
    });
    expect(forgedRemember).toMatchObject({ status: 409, body: { error: "no such pending request" } });
    const afterForgedRemember = (await api("GET", "/api/bots")).body.bots.find(
      (candidate: any) => candidate.id === bot.id,
    );
    expect(afterForgedRemember.approvalPolicy).toBe("deny");

    expect((await api("DELETE", `/api/sections/${created.body.section.id}`)).status).toBe(200);
    const after = (await api("GET", "/api/bots")).body.bots.find((candidate: any) => candidate.id === bot.id);
    expect(after.sectionId).toBeNull();
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

  it("404s unknown routes with the route in the error", async () => {
    const res = await api("GET", "/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("/api/definitely-not-a-route");
  });
});
