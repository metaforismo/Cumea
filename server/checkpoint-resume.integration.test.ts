import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { checkpointCursorDigest } from "./run-checkpoint.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CODEX = join(SERVER_DIR, "testing", "fake-codex-app-server.ts");
const scratch: string[] = [];
const children: ChildProcess[] = [];

function seed(options: { cursorMatch?: boolean; unavailable?: boolean; unknownEffect?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cumea-checkpoint-http-"));
  scratch.push(home);
  const data = join(home, ".cumea");
  mkdirSync(join(data, "attachments", "bot-resume"), { recursive: true });
  const attachmentPath = join(data, "attachments", "bot-resume", "note.txt");
  writeFileSync(attachmentPath, "durable attachment");
  const privateCursor = "codex-thread-private";
  writeFileSync(join(data, "config.json"), JSON.stringify(options.unavailable
    ? { instances: { ghost: { driver: "not-a-real-driver" } } }
    : { instances: { "codex-test": { driver: "codex", config: { cli: FAKE_CODEX, fullAuto: true, rpcTimeoutMs: 5_000 } } } }));
  writeFileSync(join(data, "bots.json"), JSON.stringify([{
    id: "bot-resume", threadId: "thread-resume", name: "Resume bot", title: "", description: "",
    notifications: true, color: "orange", avatar: { kind: "mote", shapeId: "drop", color: "#f56a16", motion: "playful" },
    unread: false, modelSelection: { instanceId: options.unavailable ? "ghost" : "codex-test", model: "gpt-5.6-sol" },
    resumeCursors: { ...(options.cursorMatch ? { "codex-test": privateCursor } : {}) }, busy: true, createdAt: 1,
  }]));
  writeFileSync(join(data, "messages-thread-resume.json"), JSON.stringify({
    messages: [
      { id: "user-original", parentId: null, role: "user", kind: "text", text: "Prepare the durable report", attachments: [{ id: "attachment-resume", name: "note.txt", mime: "text/plain", size: 18 }], at: 1 },
      { id: "bot-partial", parentId: "user-original", role: "bot", kind: "text", text: "I completed the safe first section.", at: 2 },
    ],
    activeLeafId: "bot-partial",
  }));
  const effect = options.unknownEffect ? [{
    id: "effect-unknown", runId: "run-original", taskId: "task-original", botId: "bot-resume", itemId: "tool-write",
    origin: "provider_observation", descriptor: { boundary: "provider", action: "write" },
    requestHash: `sha256:${"a".repeat(64)}`, idempotencyKey: `sha256:${"b".repeat(64)}`, fingerprint: `sha256:${"c".repeat(64)}`,
    attempt: 1, state: "unknown", audit: [{ id: "effect-audit-unknown", event: "observed_unknown", at: 2 }], createdAt: 2, updatedAt: 2,
  }] : undefined;
  writeFileSync(join(data, "workspace.json"), JSON.stringify({
    sections: [],
    attachments: [{ id: "attachment-resume", botId: "bot-resume", threadId: "thread-resume", name: "note.txt", mime: "text/plain", size: 18, storedPath: attachmentPath, createdAt: 1 }],
    tasks: [{ id: "task-original", botId: "bot-resume", title: "Durable report", prompt: "Prepare the durable report", source: "message", status: "running", attachmentIds: ["attachment-resume"], messageId: "user-original", latestRunId: "run-original", createdAt: 1, updatedAt: 2 }],
    runs: [{
      id: "run-original", taskId: "task-original", botId: "bot-resume", status: "running", attempt: 1,
      steps: [], artifacts: [{ id: "artifact-attachment", kind: "attachment", label: "note.txt", attachmentId: "attachment-resume", mime: "text/plain", createdAt: 1 }],
      ...(effect ? { effects: effect } : {}),
      checkpoint: {
        version: 1, id: "checkpoint-original", runId: "run-original", taskId: "task-original", botId: "bot-resume",
        phase: "provider", status: "available", activeLeafId: "bot-partial", provider: { instanceId: "codex-test", model: "gpt-5.6-sol" },
        cursor: { instanceId: "codex-test", digest: checkpointCursorDigest(privateCursor) }, sequence: 3, createdAt: 1, updatedAt: 2,
      }, resumeStatus: "available", startedAt: 1,
    }],
    routines: [],
  }));
  return { home, data, privateCursor };
}

async function boot(home: string, mode: "happy" | "resume" = "happy") {
  const port = 25_000 + Math.floor(Math.random() * 20_000);
  const remotePort = port + 1;
  const dump = join(home, "codex-dump.json");
  const child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home,
      CUMEA_PORT: String(port), CUMEA_REMOTE_ACCESS: "1", CUMEA_REMOTE_PORT: String(remotePort),
      CUMEA_REMOTE_PUBLIC_URL: `http://127.0.0.1:${remotePort}`, CUMEA_REMOTE_ALLOW_INSECURE: "1",
      FAKE_CODEX_MODE: mode, FAKE_CODEX_DUMP: dump,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.push(child);
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return { child, base, remoteBase: `http://127.0.0.1:${remotePort}`, dump }; } catch { /* wait */ }
    if (child.exitCode !== null) throw new Error(`checkpoint server exited ${child.exitCode}: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`checkpoint server did not start: ${stderr}`);
}

async function json(base: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

async function stop(child: ChildProcess) {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("close", () => resolve());
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3_000).unref?.();
  });
}

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => stop(child)));
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("checkpoint resume HTTP", () => {
  it.each([
    ["fresh", false, "happy"],
    ["native", true, "resume"],
  ] as const)("creates one linked %s attempt without duplicating canonical records", async (_label, cursorMatch, mode) => {
    chmodSync(FAKE_CODEX, 0o755);
    const seeded = seed({ cursorMatch });
    const server = await boot(seeded.home, mode);
    const before = (await json(server.base, "GET", "/api/work")).body.workspace;
    const interrupted = before.runs.find((run: { id: string }) => run.id === "run-original");
    expect(interrupted).toMatchObject({ status: "interrupted", resumeStatus: "available", checkpoint: { id: "checkpoint-original" } });
    expect((await json(server.base, "POST", "/api/runs/run-original/resume", {})).status).toBe(400);
    expect((await fetch(`${server.remoteBase}/api/runs/run-original/resume`, { method: "POST" })).status).toBe(401);

    const resumed = await json(server.base, "POST", "/api/runs/run-original/resume", { checkpointId: "checkpoint-original" });
    expect(resumed).toMatchObject({ status: 202, body: { resumeOfRunId: "run-original" } });
    const deadline = Date.now() + 10_000;
    let workspace: any;
    while (Date.now() < deadline) {
      workspace = (await json(server.base, "GET", "/api/work")).body.workspace;
      if (workspace.runs.find((run: { id: string }) => run.id === resumed.body.runId)?.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(workspace.tasks.filter((task: { id: string }) => task.id === "task-original")).toHaveLength(1);
    const runs = workspace.runs.filter((run: { taskId: string }) => run.taskId === "task-original");
    expect(runs).toHaveLength(2);
    expect(runs.find((run: { id: string }) => run.id === resumed.body.runId)).toMatchObject({ resumeOfRunId: "run-original", attempt: 2 });
    expect(runs.find((run: { id: string }) => run.id === resumed.body.runId).artifacts.some((artifact: { kind: string }) => artifact.kind === "attachment")).toBe(false);
    expect((await json(server.base, "POST", "/api/runs/run-original/resume", { checkpointId: "checkpoint-original" })).status).toBe(409);
    const messages = (await json(server.base, "GET", "/api/bots/bot-resume/messages")).body.messages;
    expect(messages.filter((message: { role: string }) => message.role === "user")).toHaveLength(1);
    expect(JSON.stringify(workspace)).not.toContain(seeded.privateCursor);

    const dump = JSON.parse(readFileSync(server.dump, "utf8"));
    const calls = dump.calls as Array<{ method: string; params: any }>;
    const turnText = calls.find((call) => call.method === "turn/start")?.params?.input?.[0]?.text as string;
    expect(turnText).toContain("Continue the interrupted task");
    if (cursorMatch) {
      expect(calls.some((call) => call.method === "thread/resume")).toBe(true);
      expect(turnText).not.toContain("Prepare the durable report");
      expect(turnText).not.toContain("I completed the safe first section");
    } else {
      expect(calls.some((call) => call.method === "thread/resume")).toBe(false);
      expect(turnText).toContain("Prepare the durable report");
      expect(turnText).toContain("I completed the safe first section");
    }
  }, 30_000);

  it("fails closed for unavailable providers, changed branches, unknown effects, and deletion", async () => {
    const unavailable = seed({ unavailable: true });
    const first = await boot(unavailable.home);
    expect((await json(first.base, "POST", "/api/runs/run-original/resume", { checkpointId: "checkpoint-original" }))).toMatchObject({ status: 409, body: { error: expect.stringContaining("provider_unavailable") } });
    await stop(first.child);
    children.splice(children.indexOf(first.child), 1);

    const changed = seed();
    const second = await boot(changed.home);
    expect((await json(second.base, "POST", "/api/bots/bot-resume/contexts", { label: "Different branch" })).status).toBe(201);
    expect((await json(second.base, "POST", "/api/runs/run-original/resume", { checkpointId: "checkpoint-original" }))).toMatchObject({ status: 409, body: { error: expect.stringContaining("branch_mismatch") } });
    await stop(second.child);
    children.splice(children.indexOf(second.child), 1);

    const unknown = seed({ unknownEffect: true });
    const third = await boot(unknown.home);
    expect((await json(third.base, "POST", "/api/runs/run-original/resume", { checkpointId: "checkpoint-original" }))).toMatchObject({ status: 409 });
    await stop(third.child);
    children.splice(children.indexOf(third.child), 1);

    const deleted = seed();
    const fourth = await boot(deleted.home);
    expect((await json(fourth.base, "DELETE", "/api/bots/bot-resume")).status).toBe(200);
    expect((await json(fourth.base, "POST", "/api/runs/run-original/resume", { checkpointId: "checkpoint-original" })).status).toBe(404);
  }, 45_000);
});
