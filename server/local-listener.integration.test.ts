import { spawn, type ChildProcessByStdio } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

type HarnessChild = ChildProcessByStdio<null, Readable, Readable>;

const children = new Set<HarnessChild>();
const tempDirs = new Set<string>();

async function stop(child: HarnessChild) {
  children.delete(child);
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, 2_000);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

afterEach(async () => {
  await Promise.all([...children].map(stop));
  await Promise.all(
    [...tempDirs].map(async (directory) => {
      tempDirs.delete(directory);
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

function rawRequest(
  port: number,
  {
    method = "GET",
    pathName = "/api/health",
    headers = {},
    body = "",
  }: {
    method?: string;
    pathName?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: pathName,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function startHarness(): Promise<{ child: HarnessChild; port: number }> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cumea-local-listener-"));
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
    const inspect = () => {
      const match = stdout.match(/Cumea server running on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      const port = Number(match[1]);
      finish(() => resolve({ child, port }));
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      inspect();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) =>
      finish(() =>
        reject(
          new Error(
            `harness exited before listening (${code ?? signal ?? "unknown"}): ${stderr.slice(-1_000)}`,
          ),
        ),
      ),
    );
    const timer = setTimeout(
      () => finish(() => reject(new Error(`harness did not listen in time: ${stderr.slice(-1_000)}`))),
      15_000,
    );
    timer.unref?.();
  });
}

describe("real local harness listener", () => {
  it("uses an OS-assigned port and enforces Host and Origin boundaries", async () => {
    const { child, port } = await startHarness();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65_535);
    expect(port).not.toBe(8799);

    const health = await rawRequest(port);
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ app: "cumea", pid: child.pid });

    const rebound = await rawRequest(port, {
      headers: { host: `attacker.example:${port}` },
    });
    expect(rebound.status).toBe(403);
    expect(JSON.parse(rebound.body)).toEqual({ error: "host not allowed" });

    const foreignOrigin = await rawRequest(port, {
      method: "PUT",
      pathName: "/api/config",
      headers: {
        host: `127.0.0.1:${port}`,
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ profile: { name: "Blocked" } }),
    });
    expect(foreignOrigin.status).toBe(403);
    expect(JSON.parse(foreignOrigin.body)).toEqual({ error: "origin not allowed" });

    const devOrigin = await rawRequest(port, {
      method: "PUT",
      pathName: "/api/config",
      headers: {
        host: `127.0.0.1:${port}`,
        origin: "http://127.0.0.1:5199",
        "content-type": "application/json",
      },
      body: JSON.stringify({ profile: { name: "Dev" } }),
    });
    expect(devOrigin.status).toBe(200);
    expect(JSON.parse(devOrigin.body).profile.name).toBe("Dev");
  });
});
