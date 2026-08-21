import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "memory-proxy.ts");
const CAPABILITY = "opaque-turn-memory-capability";

let stub: Server;
let child: ChildProcess;
let port = 0;
let lastAuth: string | undefined;
let remembered: unknown;
const pending = new Map<number, (message: any) => void>();
let nextId = 1;

function rpc(method: string, params?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 10_000).unref?.();
  });
}

beforeAll(async () => {
  stub = createServer((request, response) => {
    lastAuth = request.headers.authorization;
    if (lastAuth !== `Bearer ${CAPABILITY}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/internal/memory/search")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ documents: [{ path: "preferences.md", content: "Use Italian.", revision: 3 }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/internal/memory/remember") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        remembered = JSON.parse(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ document: { path: "preferences.md", revision: 4 } }));
      });
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "no route" }));
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  port = (stub.address() as { port: number }).port;

  child = spawn(process.execPath, [PROXY], {
    env: { ...process.env, CUMEA_HARNESS_URL: `http://127.0.0.1:${port}`, CUMEA_MEMORY_CAPABILITY: CAPABILITY },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buffer = "";
  child.stdout!.on("data", (chunk) => {
    buffer += chunk.toString();
    let boundary = buffer.indexOf("\n");
    while (boundary >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (line.trim()) {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
      boundary = buffer.indexOf("\n");
    }
  });
});

afterAll(async () => {
  child?.kill();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

describe("memory-proxy MCP surface", () => {
  it("lists the bounded search and persistent-write tools", async () => {
    const initialized = await rpc("initialize", { protocolVersion: "2024-11-05" });
    expect(initialized.result.serverInfo.name).toBe("cumea-memory");
    const listed = await rpc("tools/list");
    expect(listed.result.tools.map((tool: any) => tool.name)).toEqual(["search_memory", "remember"]);
  });

  it("searches through the opaque turn capability", async () => {
    const response = await rpc("tools/call", { name: "search_memory", arguments: { query: "language" } });
    expect(response.result.content[0].text).toContain("Use Italian");
    expect(lastAuth).toBe(`Bearer ${CAPABILITY}`);
  });

  it("forwards a complete revision without accepting bot or provenance ids", async () => {
    const response = await rpc("tools/call", {
      name: "remember",
      arguments: { path: "preferences.md", content: "Use concise Italian.", pinned: true, botId: "forged" },
    });
    expect(response.result.content[0].text).toContain("revision 4");
    expect(remembered).toEqual({ path: "preferences.md", content: "Use concise Italian.", pinned: true });
  });
});
