import { readFileSync, writeFileSync } from "node:fs";

const file = "server/index.ts";
let source = readFileSync(file, "utf8");

function replaceOnce(pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`${label}: expected exactly one source match`);
  }
  source = source.replace(pattern, replacement);
}

function replaceLiteralOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  const last = source.lastIndexOf(needle);
  if (first < 0 || first !== last) {
    throw new Error(`${label}: expected exactly one literal source match`);
  }
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceLiteralOnce(
  'import { writeFileAtomic } from "./atomic.ts";\n',
  `import { writeFileAtomic } from "./atomic.ts";\nimport {\n  localHostAllowed,\n  localOriginAllowed,\n  postHarnessReady,\n  requestedLocalPort,\n  requestedRemotePort,\n  tcpPort,\n} from "./local-listener.ts";\n`,
  "local-listener import",
);

replaceLiteralOnce(
  'const PORT = Number(process.env.CUMEA_PORT || 8799);\nconst STATIC_DIR = process.env.CUMEA_STATIC_DIR || null;',
  'const REQUESTED_LOCAL_PORT = requestedLocalPort();\nlet LOCAL_PORT = REQUESTED_LOCAL_PORT;\nconst STATIC_DIR = process.env.CUMEA_STATIC_DIR || null;',
  "requested local port",
);

replaceLiteralOnce(
  'const port = Number(process.env.CUMEA_REMOTE_PORT || PORT + 1);',
  'const port = requestedRemotePort();',
  "remote default port",
);

replaceLiteralOnce(
  'port === PORT',
  'REQUESTED_LOCAL_PORT !== 0 && port === REQUESTED_LOCAL_PORT',
  "remote/local requested collision",
);

replaceLiteralOnce(
  'CUMEA_HARNESS_URL: `http://127.0.0.1:${PORT}`',
  'CUMEA_HARNESS_URL: `http://127.0.0.1:${LOCAL_PORT}`',
  "internal harness URL",
);

replaceOnce(
  /function requestOriginAllowed\(req: IncomingMessage, method: string\): boolean \{[\s\S]*?\n\}\n\nfunction bearerToken/,
  `function requestOriginAllowed(req: IncomingMessage, method: string): boolean {\n  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;\n  const rawOrigin = req.headers.origin;\n  if (!rawOrigin) return true;\n  return localOriginAllowed(rawOrigin, LOCAL_PORT);\n}\n\nfunction bearerToken`,
  "request origin boundary",
);

replaceLiteralOnce(
  '  const path = url.pathname;\n  const method = req.method ?? "GET";\n  try {',
  `  const path = url.pathname;\n  const method = req.method ?? "GET";\n  if (surface === "local" && !localHostAllowed(req.headers.host, LOCAL_PORT)) {\n    return json(res, 403, { error: "host not allowed" });\n  }\n  try {`,
  "local Host boundary",
);

replaceLiteralOnce(
  '`http://localhost:${PORT}`',
  '`http://localhost:${LOCAL_PORT}`',
  "request parsing base",
);

const tailMarker = '\nconst server = createServer((req, res) => {';
const tailStart = source.lastIndexOf(tailMarker);
if (tailStart < 0 || source.indexOf(tailMarker) !== tailStart) {
  throw new Error("listener tail: expected exactly one local server marker");
}

const tail = `\nfunction listenTcp(\n  listener: ReturnType<typeof createServer>,\n  port: number,\n  bind: string,\n): Promise<number> {\n  return new Promise((resolve, reject) => {\n    const onError = (error: Error) => {\n      listener.off("listening", onListening);\n      reject(error);\n    };\n    const onListening = () => {\n      listener.off("error", onError);\n      try {\n        resolve(tcpPort(listener.address()));\n      } catch (error) {\n        listener.close();\n        reject(error);\n      }\n    };\n    listener.once("error", onError);\n    listener.once("listening", onListening);\n    listener.listen(port, bind);\n  });\n}\n\nlet remoteServer: ReturnType<typeof createServer> | null = null;\nif (REMOTE) {\n  remoteServer = createServer((req, res) => {\n    void handleRequest(req, res, "remote");\n  });\n  await listenTcp(remoteServer, REMOTE.port, REMOTE.bind);\n  console.log(\n    \`Cumea remote listener running on \${REMOTE.bind}:\${REMOTE.port} (public \${REMOTE.publicUrl})\`,\n  );\n}\n\nconst server = createServer((req, res) => {\n  void handleRequest(req, res, "local");\n});\nLOCAL_PORT = await listenTcp(server, REQUESTED_LOCAL_PORT, "127.0.0.1");\nconsole.log(\`Cumea server running on http://127.0.0.1:\${LOCAL_PORT}\`);\npostHarnessReady(LOCAL_PORT);\n`;
source = `${source.slice(0, tailStart)}${tail}`;

if (/\bPORT\b/.test(source)) {
  const lines = source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /\bPORT\b/.test(line));
  throw new Error(`legacy PORT symbol remains: ${JSON.stringify(lines)}`);
}
if (!source.includes("postHarnessReady(LOCAL_PORT);")) {
  throw new Error("readiness publication missing after listener refactor");
}
if (!source.includes('if (surface === "local" && !localHostAllowed(req.headers.host, LOCAL_PORT))')) {
  throw new Error("local Host boundary missing after listener refactor");
}

writeFileSync(file, source);
