import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDesktopGateway } from "./desktop-gateway.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function freePort() {
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  return port;
}

test("gateway serves the packaged shell before a harness target exists", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-gateway-"));
  mkdirSync(path.join(directory, "assets"));
  writeFileSync(path.join(directory, "index.html"), "<main>Cumea shell</main>");
  writeFileSync(path.join(directory, "assets", "app.js"), "console.log('ok')");
  const gateway = createDesktopGateway({ staticDir: directory, port: await freePort() });
  try {
    const { origin, port } = await gateway.start();
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(port > 0);

    const shell = await fetch(origin);
    assert.equal(shell.status, 200);
    assert.equal(await shell.text(), "<main>Cumea shell</main>");
    assert.match(shell.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
    assert.equal(shell.headers.get("x-frame-options"), "DENY");

    const pending = await fetch(`${origin}/api/config`);
    assert.equal(pending.status, 503);
    assert.deepEqual(await pending.json(), { error: "agent host is starting" });
    assert.equal(pending.headers.get("cache-control"), "no-store");
  } finally {
    await gateway.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("gateway streams API and SSE traffic only to its validated loopback target", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cumea-gateway-"));
  writeFileSync(path.join(directory, "index.html"), "shell");
  const harness = createServer((req, res) => {
    if (req.url === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
      res.write('data: {"kind":"hello"}\n\n');
      setTimeout(() => res.end('data: {"kind":"done"}\n\n'), 15);
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      res.writeHead(201, {
        "content-type": "application/json",
        connection: "close",
        "x-upstream": "yes",
      });
      res.end(JSON.stringify({ method: req.method, body, host: req.headers.host }));
    });
  });
  const gateway = createDesktopGateway({ staticDir: directory, port: await freePort() });
  try {
    const harnessPort = await listen(harness);
    const { origin } = await gateway.start();
    gateway.setHarnessTarget(harnessPort);

    const response = await fetch(`${origin}/api/config`, {
      method: "POST",
      headers: { "content-type": "text/plain", connection: "keep-alive" },
      body: "candidate",
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-upstream"), "yes");
    const payload = await response.json();
    assert.equal(payload.method, "POST");
    assert.equal(payload.body, "candidate");
    assert.equal(payload.host, `127.0.0.1:${harnessPort}`);

    const events = await fetch(`${origin}/api/events`);
    assert.equal(events.status, 200);
    assert.equal(events.headers.get("content-type"), "text/event-stream");
    const text = await events.text();
    assert.match(text, /"kind":"hello"/);
    assert.match(text, /"kind":"done"/);

    gateway.clearHarnessTarget();
    const afterClear = await fetch(`${origin}/api/health`);
    assert.equal(afterClear.status, 503);
  } finally {
    await gateway.close();
    await close(harness);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("gateway rejects invalid targets and filesystem escape attempts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cumea-gateway-"));
  const directory = path.join(root, "ui");
  mkdirSync(directory);
  writeFileSync(path.join(directory, "index.html"), "shell");
  writeFileSync(path.join(root, "secret.txt"), "secret");
  const gateway = createDesktopGateway({ staticDir: directory, port: await freePort() });
  try {
    const { origin, port } = await gateway.start();
    assert.throws(() => gateway.setHarnessTarget(0), /invalid harness target/);
    assert.throws(() => gateway.setHarnessTarget(70_000), /invalid harness target/);
    assert.throws(() => gateway.setHarnessTarget(port), /cannot proxy to itself/);

    const escaped = await fetch(`${origin}/..%2Fsecret.txt`);
    assert.equal(escaped.status, 404);
    assert.doesNotMatch(await escaped.text(), /secret/);
  } finally {
    await gateway.close();
    rmSync(root, { recursive: true, force: true });
  }
});
