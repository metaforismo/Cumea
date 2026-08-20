import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function startHarness() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cumea-file-preview-"));
  directories.add(dataDir);
  const remotePort = await reserveLoopbackPort();
  const child = spawn(process.execPath, ["server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CUMEA_DATA_DIR: dataDir,
      CUMEA_PORT: "0",
      CUMEA_REMOTE_ACCESS: "1",
      CUMEA_REMOTE_PORT: String(remotePort),
      CUMEA_REMOTE_PUBLIC_URL: `http://127.0.0.1:${remotePort}`,
      CUMEA_REMOTE_ALLOW_INSECURE: "1",
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
    child.once("exit", (code, signal) => finish(() => reject(
      new Error(`harness exited before listening (${code ?? signal ?? "unknown"}): ${stderr.slice(-1_000)}`),
    )));
    const timer = setTimeout(
      () => finish(() => reject(new Error(`harness did not listen in time: ${stderr.slice(-1_000)}`))),
      15_000,
    );
    timer.unref?.();
  });
  return { dataDir, port, remotePort };
}

async function json(port: number, route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function postJson(port: number, route: string, body: unknown, headers: Record<string, string> = {}) {
  return json(port, route, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("local file capability HTTP boundary", () => {
  it("keeps file authority local-only, host-owned and revocable", async () => {
    const { dataDir, port, remotePort } = await startHarness();
    const created = await postJson(port, "/api/bots", { name: "Files" });
    expect(created.response.status).toBe(201);
    const bot = (created.body as any).bot as { id: string };

    const botWorkspace = path.join(dataDir, "bot-workspaces", bot.id);
    await mkdir(botWorkspace, { recursive: true });
    await writeFile(path.join(botWorkspace, "report.md"), "# Safe report\n\nNo HTML executes here.");
    await writeFile(path.join(botWorkspace, "blob.bin"), Buffer.from([0, 1, 2, 3, 255]));
    await writeFile(path.join(dataDir, "outside.md"), "secret");

    const traversal = await postJson(port, `/api/bots/${bot.id}/files/resolve`, { path: "../../outside.md" });
    expect(traversal.response.status).toBe(403);

    const resolved = await postJson(port, `/api/bots/${bot.id}/files/resolve`, { path: "./report.md" });
    expect(resolved.response.status).toBe(200);
    expect(resolved.response.headers.get("cache-control")).toBe("no-store");
    const workspaceFile = (resolved.body as any).file;
    expect(workspaceFile).toMatchObject({ name: "report.md", kind: "markdown", source: "local" });
    expect(JSON.stringify(workspaceFile)).not.toContain(dataDir);

    const preview = await fetch(`http://127.0.0.1:${port}${workspaceFile.previewUrl}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    await expect(preview.json()).resolves.toMatchObject({
      preview: { kind: "markdown", text: expect.stringContaining("Safe report") },
    });

    const download = await fetch(`http://127.0.0.1:${port}${workspaceFile.downloadUrl}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    await expect(download.text()).resolves.toContain("Safe report");

    const binaryResolved = await postJson(port, `/api/bots/${bot.id}/files/resolve`, { path: "./blob.bin" });
    expect(binaryResolved.response.status).toBe(200);
    const binaryFile = (binaryResolved.body as any).file;
    expect(binaryFile).toMatchObject({ name: "blob.bin", kind: "binary", source: "local" });
    const binaryPreview = await fetch(`http://127.0.0.1:${port}${binaryFile.previewUrl}`);
    expect(binaryPreview.status).toBe(415);
    const binaryDownload = await fetch(`http://127.0.0.1:${port}${binaryFile.downloadUrl}`);
    expect(binaryDownload.status).toBe(200);
    expect(Buffer.from(await binaryDownload.arrayBuffer())).toEqual(Buffer.from([0, 1, 2, 3, 255]));

    const uploadBytes = Buffer.from("# Uploaded attachment\n");
    const upload = await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}/attachments`, {
      method: "POST",
      headers: {
        "content-type": "text/markdown",
        "x-file-name": encodeURIComponent("attachment.md"),
        "content-length": String(uploadBytes.length),
      },
      body: uploadBytes,
    });
    expect(upload.status).toBe(201);
    const attachment = (await upload.json() as any).attachment;
    const attachmentResolved = await postJson(port, `/api/attachments/${attachment.id}/files/resolve`, {});
    expect(attachmentResolved.response.status).toBe(200);
    const attachmentFile = (attachmentResolved.body as any).file;
    expect(attachmentFile).toMatchObject({ name: "attachment.md", kind: "markdown", source: "attachment" });
    expect(JSON.stringify(attachmentFile)).not.toContain(dataDir);

    const pairing = await postJson(port, "/api/pairing/sessions", { ttlMs: 60_000 });
    expect(pairing.response.status).toBe(201);
    const claim = await fetch(`http://127.0.0.1:${remotePort}/api/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: (pairing.body as any).session.id,
        secret: (pairing.body as any).session.secret,
        deviceName: "File boundary",
      }),
    });
    expect(claim.status).toBe(201);
    const token = String((await claim.json() as any).token);
    const auth = { authorization: `Bearer ${token}` };

    const remoteResolve = await postJson(remotePort, `/api/bots/${bot.id}/files/resolve`, { path: "report.md" }, auth);
    expect(remoteResolve.response.status).toBe(403);
    const remoteAttachmentResolve = await postJson(remotePort, `/api/attachments/${attachment.id}/files/resolve`, {}, auth);
    expect(remoteAttachmentResolve.response.status).toBe(403);
    const remotePreview = await fetch(`http://127.0.0.1:${remotePort}${workspaceFile.previewUrl}`, { headers: auth });
    expect(remotePreview.status).toBe(403);
    const remoteDownload = await fetch(`http://127.0.0.1:${remotePort}${workspaceFile.downloadUrl}`, { headers: auth });
    expect(remoteDownload.status).toBe(403);

    const deleted = await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(existsSync(botWorkspace)).toBe(false);
    const revoked = await fetch(`http://127.0.0.1:${port}${workspaceFile.previewUrl}`);
    expect(revoked.status).toBe(404);
    const revokedAttachment = await fetch(`http://127.0.0.1:${port}${attachmentFile.previewUrl}`);
    expect(revokedAttachment.status).toBe(404);
  }, 40_000);
});
