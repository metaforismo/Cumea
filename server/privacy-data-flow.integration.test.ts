import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 40_000 + Math.floor(Math.random() * 4_000);
const REMOTE_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const REMOTE = `http://127.0.0.1:${REMOTE_PORT}`;
const PRIVATE_PROVIDER_ID = "private-provider-instance";
const PRIVATE_LABEL = "Confidential provider label";
const PRIVATE_PATH = "/Users/private/custom-provider";
const PRIVATE_KEY = "ck_private_data_flow_sentinel";
let child: ChildProcess;
let home: string;

async function api(method: string, path: string, body?: unknown, base = BASE, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cumea-privacy-http-"));
  mkdirSync(join(home, ".cumea"), { recursive: true });
  writeFileSync(join(home, ".cumea", "config.json"), JSON.stringify({
    profile: { name: "Private profile sentinel" },
    instances: {
      [PRIVATE_PROVIDER_ID]: { driver: "future-private-adapter", displayName: PRIVATE_LABEL, config: { executable: PRIVATE_PATH } },
    },
  }));
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      PATH: "/usr/bin:/bin", HOME: home, USERPROFILE: home,
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

describe("privacy data-flow HTTP boundary", () => {
  it("is local-only, redacted, runtime-derived and absent from mobile projections", async () => {
    const first = await api("GET", "/api/privacy/data-flows");
    expect(first.status).toBe(200);
    expect(first.body.rows).toHaveLength(13);
    expect(first.body.rows.find((row: any) => row.id === "service.composio")).toMatchObject({ enabled: false, available: false });
    expect(first.body.rows.find((row: any) => row.id === "provider.config.unknown")).toMatchObject({ enabled: true, available: false });
    const serialized = JSON.stringify(first.body);
    for (const secret of [PRIVATE_PROVIDER_ID, PRIVATE_LABEL, PRIVATE_PATH, "Private profile sentinel", home]) expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/https?:\/\//);

    expect((await api("GET", "/api/privacy/data-flows", undefined, REMOTE)).status).toBe(401);
    const session = await api("POST", "/api/pairing/sessions", { ttlMs: 60_000 });
    const claim = await api("POST", "/api/pairing/claim", {
      sessionId: session.body.session.id, secret: session.body.session.secret, deviceName: "Privacy boundary phone",
    }, REMOTE);
    expect(claim.status).toBe(201);
    expect((await api("GET", "/api/privacy/data-flows", undefined, REMOTE, claim.body.token)).status).toBe(403);

    const mobile = await api("GET", "/api/mobile/bootstrap", undefined, REMOTE, claim.body.token);
    expect(mobile.status).toBe(200);
    expect(JSON.stringify(mobile.body)).not.toContain("provider.config.unknown");
    expect(JSON.stringify(mobile.body)).not.toContain("dataCategories");

    const saved = await api("PUT", "/api/config", { composio: { key: PRIVATE_KEY } });
    expect(saved.status).toBe(200);
    const changed = await api("GET", "/api/privacy/data-flows");
    expect(changed.body.rows.find((row: any) => row.id === "service.composio")).toMatchObject({ enabled: true, available: true });
    expect(JSON.stringify(changed.body)).not.toContain(PRIVATE_KEY);

    const events = await fetch(`${REMOTE}/api/events`, { headers: { authorization: `Bearer ${claim.body.token}` } });
    const reader = events.body!.getReader();
    const firstEvent = await reader.read();
    expect(new TextDecoder().decode(firstEvent.value)).toContain('{"kind":"hello"}');
    expect(new TextDecoder().decode(firstEvent.value)).not.toContain("dataCategories");
    await reader.cancel();
  });
});
