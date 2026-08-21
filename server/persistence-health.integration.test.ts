import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 35_000 + Math.floor(Math.random() * 5_000);
const REMOTE_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const REMOTE = `http://127.0.0.1:${REMOTE_PORT}`;
let child: ChildProcess;
let home: string;

async function api(method: string, path: string, body?: unknown, base = BASE) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cumea-persistence-http-"));
  mkdirSync(join(home, ".cumea"), { recursive: true });
  writeFileSync(join(home, ".cumea", "config.json"), "{private-broken-provider-secret");
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home,
      CUMEA_PORT: String(PORT), CUMEA_REMOTE_ACCESS: "1", CUMEA_REMOTE_PORT: String(REMOTE_PORT),
      CUMEA_REMOTE_PUBLIC_URL: REMOTE, CUMEA_REMOTE_ALLOW_INSECURE: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* wait */ }
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${stderr}`);
}, 20_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("close", () => resolve());
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3_000).unref?.();
  });
  rmSync(home, { recursive: true, force: true });
});

describe("persistence recovery HTTP", () => {
  it("keeps diagnostics and recovery local, redacted, exact and explicit", async () => {
    const diagnostics = await api("GET", "/api/persistence/issues");
    expect(diagnostics).toMatchObject({ status: 200, body: { issues: [expect.objectContaining({ file: "config.json", kind: "malformed", writesBlocked: true })] } });
    const encoded = JSON.stringify(diagnostics.body);
    expect(encoded).not.toContain("private-broken-provider-secret");
    expect(encoded).not.toContain(home);
    const issue = diagnostics.body.issues[0];

    expect((await api("PATCH", "/api/config", { profile: { name: "must not overwrite" } })).status).toBe(503);
    expect(readFileSync(join(home, ".cumea", "config.json"), "utf8")).toBe("{private-broken-provider-secret");
    expect((await fetch(`${REMOTE}/api/persistence/issues`)).status).toBe(401);
    const pairing = await api("POST", "/api/pairing/sessions", { ttlMs: 60_000 });
    const claimResponse = await fetch(`${REMOTE}/api/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: pairing.body.session.id,
        secret: pairing.body.session.secret,
        deviceName: "Persistence isolation test",
      }),
    });
    const claimed = await claimResponse.json() as { token: string };
    expect((await fetch(`${REMOTE}/api/persistence/issues`, { headers: { authorization: `Bearer ${claimed.token}` } })).status).toBe(403);
    expect((await fetch(`${REMOTE}/api/persistence/issues/${issue.id}/reset`, {
      method: "POST",
      headers: { authorization: `Bearer ${claimed.token}`, "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "config.json" }),
    })).status).toBe(403);
    expect((await api("POST", `/api/persistence/issues/${issue.id}/reset`, { confirmation: "wrong.json" })).status).toBe(400);

    const reset = await api("POST", `/api/persistence/issues/${issue.id}/reset`, { confirmation: "config.json" });
    expect(reset).toMatchObject({ status: 200, body: { file: "config.json", restartRequired: true } });
    expect(JSON.parse(readFileSync(join(home, ".cumea", "config.json"), "utf8"))).toEqual({});
    const preserved = readdirSync(join(home, ".cumea", "recovery"));
    expect(preserved).toHaveLength(1);
    expect(readFileSync(join(home, ".cumea", "recovery", preserved[0]), "utf8")).toBe("{private-broken-provider-secret");
    expect((await api("GET", "/api/persistence/issues")).body.issues).toEqual([expect.objectContaining({ id: issue.id, recoveryPendingRestart: true })]);
    expect((await api("PATCH", "/api/config", { profile: { name: "still blocked" } })).status).toBe(503);
    expect(JSON.parse(readFileSync(join(home, ".cumea", "config.json"), "utf8"))).toEqual({});
  });
});
