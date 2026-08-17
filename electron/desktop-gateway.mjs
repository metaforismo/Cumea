import { createReadStream, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";

const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_DESKTOP_GATEWAY_PORT = 8799;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
});
const DOCUMENT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");
const MIME = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

function publicError(res, status, message) {
  const body = Buffer.from(`${JSON.stringify({ error: message })}\n`, "utf8");
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    ...(status === 503 ? { "retry-after": "1" } : {}),
  });
  res.end(body);
}

function gatewayAddress(server) {
  const address = server.address();
  if (!address || typeof address === "string" || !Number.isInteger(address.port)) {
    throw new Error("desktop gateway did not expose a loopback TCP port");
  }
  return { port: address.port, origin: `http://${LOOPBACK_HOST}:${address.port}` };
}

function sanitizedProxyHeaders(headers, targetPort) {
  const next = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    if (name.toLowerCase() === "host") continue;
    next[name] = value;
  }
  next.host = `${LOOPBACK_HOST}:${targetPort}`;
  return next;
}

function sanitizedResponseHeaders(headers) {
  const next = { ...SECURITY_HEADERS };
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    next[name] = value;
  }
  return next;
}

function safeStaticPath(staticDir, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl || "/", "http://cumea.invalid");
  } catch {
    return null;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return null;
  const root = path.resolve(staticDir);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

function readableFile(candidate) {
  try {
    const details = statSync(candidate);
    return details.isFile() ? details : null;
  } catch {
    return null;
  }
}

function serveStatic(req, res, staticDir) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    publicError(res, 405, "method not allowed");
    return;
  }

  const candidate = safeStaticPath(staticDir, req.url);
  if (!candidate) {
    publicError(res, 404, "not found");
    return;
  }
  let selected = candidate;
  let details = readableFile(selected);
  if (!details) {
    selected = path.join(path.resolve(staticDir), "index.html");
    details = readableFile(selected);
  }
  if (!details) {
    publicError(res, 404, "desktop UI is unavailable");
    return;
  }

  const extension = path.extname(selected).toLowerCase();
  const headers = {
    ...SECURITY_HEADERS,
    "content-type": MIME[extension] ?? "application/octet-stream",
    "content-length": String(details.size),
    ...(extension === ".html"
      ? { "content-security-policy": DOCUMENT_CSP, "cache-control": "no-store" }
      : { "cache-control": "public, max-age=31536000, immutable" }),
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(selected);
  stream.on("error", () => {
    if (!res.headersSent) publicError(res, 500, "desktop UI could not be read");
    else res.destroy();
  });
  stream.pipe(res);
}

function proxyApi(req, res, targetPort) {
  const upstream = httpRequest(
    {
      host: LOOPBACK_HOST,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: sanitizedProxyHeaders(req.headers, targetPort),
    },
    (upstreamResponse) => {
      res.writeHead(
        upstreamResponse.statusCode ?? 502,
        sanitizedResponseHeaders(upstreamResponse.headers),
      );
      upstreamResponse.on("error", () => res.destroy());
      upstreamResponse.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) publicError(res, 503, "agent host is restarting");
    else res.destroy();
  });
  req.on("aborted", () => upstream.destroy());
  req.on("error", () => upstream.destroy());
  res.on("close", () => {
    if (!res.writableEnded) upstream.destroy();
  });
  req.pipe(upstream);
}

export function createDesktopGateway({
  staticDir,
  host = LOOPBACK_HOST,
  port = DEFAULT_DESKTOP_GATEWAY_PORT,
} = {}) {
  if (!staticDir || typeof staticDir !== "string") {
    throw new Error("desktop gateway requires a static UI directory");
  }
  if (host !== LOOPBACK_HOST) throw new Error("desktop gateway must bind IPv4 loopback");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("desktop gateway requires a stable TCP port");
  }

  let targetPort = null;
  let started = null;
  let closing = null;
  const server = createServer((req, res) => {
    let pathname = "/";
    try {
      pathname = new URL(req.url || "/", "http://cumea.invalid").pathname;
    } catch {
      publicError(res, 400, "invalid request URL");
      return;
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      if (!targetPort) {
        publicError(res, 503, "agent host is starting");
        return;
      }
      proxyApi(req, res, targetPort);
      return;
    }
    serveStatic(req, res, staticDir);
  });

  return {
    async start() {
      if (started) return started;
      started = await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve(gatewayAddress(server));
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      return started;
    },
    address() {
      return started;
    },
    setHarnessTarget(nextPort) {
      if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65_535) {
        throw new Error("invalid harness target port");
      }
      if (started?.port === nextPort) throw new Error("desktop gateway cannot proxy to itself");
      targetPort = nextPort;
    },
    clearHarnessTarget() {
      targetPort = null;
    },
    harnessTarget() {
      return targetPort;
    },
    async close() {
      targetPort = null;
      if (closing) return closing;
      if (!server.listening) return;
      closing = new Promise((resolve) => server.close(() => resolve()));
      await closing;
    },
  };
}
