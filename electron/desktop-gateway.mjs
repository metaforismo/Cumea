import { createReadStream, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";

const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_DESKTOP_GATEWAY_PORT = 8799;
const STATIC_HOP_BY_HOP_HEADERS = new Set([
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
const LOCKED_RESPONSE_HEADERS = new Set([
  "cross-origin-resource-policy",
  "referrer-policy",
  "x-content-type-options",
  "x-frame-options",
]);
const GATEWAY_STATE_BY_REASON = new Map([
  ["agent host is starting", "starting"],
  ["agent host is restarting", "restarting"],
  ["agent host could not start", "failed"],
]);
const PUBLIC_UNAVAILABLE_REASONS = new Set(GATEWAY_STATE_BY_REASON.keys());

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
  const gatewayState = status === 503 ? GATEWAY_STATE_BY_REASON.get(message) : undefined;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    ...(gatewayState
      ? {
          "retry-after": "1",
          "x-cumea-desktop-state": gatewayState,
        }
      : {}),
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

function connectionNamedHeaders(headers) {
  const named = new Set();
  const raw = headers.connection;
  if (typeof raw === "string") {
    for (const value of raw.split(",")) {
      const normalized = value.trim().toLowerCase();
      if (normalized) named.add(normalized);
    }
  }
  return named;
}

function sanitizedProxyHeaders(headers, targetPort, gatewayPort) {
  const next = {};
  const dynamicHopHeaders = connectionNamedHeaders(headers);
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (
      value === undefined ||
      STATIC_HOP_BY_HOP_HEADERS.has(normalizedName) ||
      dynamicHopHeaders.has(normalizedName)
    ) {
      continue;
    }
    if (normalizedName === "host") continue;
    if (normalizedName === "origin") {
      const gatewayOrigin = `http://${LOOPBACK_HOST}:${gatewayPort}`;
      next.origin =
        value === gatewayOrigin ? `http://${LOOPBACK_HOST}:${targetPort}` : value;
      continue;
    }
    next[name] = value;
  }
  next.host = `${LOOPBACK_HOST}:${targetPort}`;
  return next;
}

function sanitizedResponseHeaders(headers) {
  const next = { ...SECURITY_HEADERS };
  const dynamicHopHeaders = connectionNamedHeaders(headers);
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (
      value === undefined ||
      STATIC_HOP_BY_HOP_HEADERS.has(normalizedName) ||
      dynamicHopHeaders.has(normalizedName) ||
      LOCKED_RESPONSE_HEADERS.has(normalizedName)
    ) {
      continue;
    }
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
    // Only route-like paths fall back to the SPA shell. Missing asset/module
    // paths fail closed instead of returning HTML with a misleading MIME type.
    if (path.extname(candidate)) {
      publicError(res, 404, "not found");
      return;
    }
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

function proxyApi(req, res, targetPort, gatewayPort) {
  const upstream = httpRequest(
    {
      host: LOOPBACK_HOST,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: sanitizedProxyHeaders(req.headers, targetPort, gatewayPort),
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

  const expectedHostHeader = `${LOOPBACK_HOST}:${port}`;
  let targetPort = null;
  let unavailableReason = "agent host is starting";
  let started = null;
  let closing = null;
  const server = createServer((req, res) => {
    // Binding loopback is not sufficient against browser DNS rebinding. The
    // renderer always navigates to the numeric loopback origin, so any other
    // Host value is invalid and must be rejected before serving UI or API.
    if (req.headers.host !== expectedHostHeader) {
      publicError(res, 403, "host not allowed");
      return;
    }

    let pathname = "/";
    try {
      pathname = new URL(req.url || "/", "http://cumea.invalid").pathname;
    } catch {
      publicError(res, 400, "invalid request URL");
      return;
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      if (!targetPort) {
        publicError(res, 503, unavailableReason);
        return;
      }
      proxyApi(req, res, targetPort, port);
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
      unavailableReason = "agent host is starting";
    },
    clearHarnessTarget(reason = "agent host is starting") {
      if (!PUBLIC_UNAVAILABLE_REASONS.has(reason)) {
        throw new Error("invalid public harness unavailable reason");
      }
      targetPort = null;
      unavailableReason = reason;
    },
    harnessTarget() {
      return targetPort;
    },
    async close() {
      targetPort = null;
      if (closing) return closing;
      if (!server.listening) return;
      closing = new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closing;
    },
  };
}
