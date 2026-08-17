import { readFileSync, writeFileSync } from "node:fs";

function edit(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: transform made no changes`);
  writeFileSync(path, after);
}

function literal(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

function regexOnce(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`${label}: expected exactly one match`);
  return source.replace(pattern, replacement);
}

edit("server/index.ts", (input) => {
  let source = input;
  source = literal(
    source,
    'import { writeFileAtomic } from "./atomic.ts";\n',
    `import { writeFileAtomic } from "./atomic.ts";\nimport {\n  localHostAllowed,\n  localOriginAllowed,\n  postHarnessReady,\n  requestedLocalPort,\n  requestedRemotePort,\n  tcpPort,\n} from "./local-listener.ts";\n`,
    "server local-listener import",
  );
  source = literal(
    source,
    'const PORT = Number(process.env.CUMEA_PORT || 8799);\nconst STATIC_DIR = process.env.CUMEA_STATIC_DIR || null;',
    'const REQUESTED_LOCAL_PORT = requestedLocalPort();\nlet LOCAL_PORT = REQUESTED_LOCAL_PORT;\nconst STATIC_DIR = process.env.CUMEA_STATIC_DIR || null;',
    "server requested local port",
  );
  source = literal(
    source,
    'const port = Number(process.env.CUMEA_REMOTE_PORT || PORT + 1);',
    'const port = requestedRemotePort();',
    "server remote port",
  );
  source = literal(
    source,
    'port === PORT',
    'REQUESTED_LOCAL_PORT !== 0 && port === REQUESTED_LOCAL_PORT',
    "server fixed-port collision",
  );
  source = literal(
    source,
    'CUMEA_HARNESS_URL: `http://127.0.0.1:${PORT}`',
    'CUMEA_HARNESS_URL: `http://127.0.0.1:${LOCAL_PORT}`',
    "server internal harness URL",
  );
  source = regexOnce(
    source,
    /function requestOriginAllowed\(req: IncomingMessage, method: string\): boolean \{[\s\S]*?\n\}\n\nfunction bearerToken/,
    `function requestOriginAllowed(req: IncomingMessage, method: string): boolean {\n  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;\n  const origin = req.headers.origin;\n  if (!origin) return true; // native app, CLI, and internal agent helpers\n  return localOriginAllowed(origin, LOCAL_PORT);\n}\n\nfunction bearerToken`,
    "server origin boundary",
  );
  source = literal(
    source,
    '`http://localhost:${PORT}`',
    '`http://localhost:${LOCAL_PORT}`',
    "server local parse origin",
  );
  source = literal(
    source,
    '  const path = url.pathname;\n  const method = req.method ?? "GET";\n  try {',
    `  const path = url.pathname;\n  const method = req.method ?? "GET";\n  if (surface === "local" && !localHostAllowed(req.headers.host, LOCAL_PORT)) {\n    return json(res, 403, { error: "host not allowed" });\n  }\n  try {`,
    "server Host boundary",
  );

  const tail = `const server = createServer((req, res) => void handleRequest(req, res, "local"));\nserver.listen(PORT, "127.0.0.1", () => {\n  console.log(\`cumea server on http://127.0.0.1:\${PORT}\`);\n});\n\nconst remoteServer = REMOTE ? createServer((req, res) => void handleRequest(req, res, "remote")) : null;\nremoteServer?.listen(REMOTE!.port, REMOTE!.bind, () => {\n  console.log(\`cumea authenticated mobile listener on http://\${REMOTE!.bind}:\${REMOTE!.port}\`);\n});`;
  const replacement = `function listenTcp(\n  listener: ReturnType<typeof createServer>,\n  port: number,\n  bind: string,\n): Promise<number> {\n  return new Promise((resolve, reject) => {\n    const onError = (error: Error) => {\n      listener.off("listening", onListening);\n      reject(error);\n    };\n    const onListening = () => {\n      listener.off("error", onError);\n      try {\n        resolve(tcpPort(listener.address()));\n      } catch (error) {\n        listener.close();\n        reject(error);\n      }\n    };\n    listener.once("error", onError);\n    listener.once("listening", onListening);\n    listener.listen(port, bind);\n  });\n}\n\nlet remoteServer: ReturnType<typeof createServer> | null = null;\nif (REMOTE) {\n  remoteServer = createServer((req, res) => void handleRequest(req, res, "remote"));\n  await listenTcp(remoteServer, REMOTE.port, REMOTE.bind);\n  console.log(\`Cumea remote listener running on \${REMOTE.bind}:\${REMOTE.port}\`);\n}\n\nconst server = createServer((req, res) => void handleRequest(req, res, "local"));\nLOCAL_PORT = await listenTcp(server, REQUESTED_LOCAL_PORT, "127.0.0.1");\nconsole.log(\`Cumea server running on http://127.0.0.1:\${LOCAL_PORT}\`);\npostHarnessReady(LOCAL_PORT);`;
  source = literal(source, tail, replacement, "server listener tail");
  if (/\bPORT\b/.test(source)) {
    const remains = source.split("\n").filter((line) => /\bPORT\b/.test(line));
    throw new Error(`server legacy PORT remains: ${JSON.stringify(remains)}`);
  }
  for (const invariant of [
    "requestedLocalPort()",
    "requestedRemotePort()",
    "localHostAllowed(req.headers.host, LOCAL_PORT)",
    "localOriginAllowed(origin, LOCAL_PORT)",
    "postHarnessReady(LOCAL_PORT)",
  ]) {
    if (!source.includes(invariant)) throw new Error(`server invariant missing: ${invariant}`);
  }
  return source;
});

edit("electron/main.mjs", (input) => {
  let source = input;
  source = literal(
    source,
    'import { createDesktopCredentialController } from "./desktop-credentials.mjs";\n',
    'import { createDesktopCredentialController } from "./desktop-credentials.mjs";\nimport { waitForHarnessReady } from "./harness-process.mjs";\n',
    "electron readiness import",
  );
  source = literal(
    source,
    'const PACKAGED_HARNESS_PORTS = [18799, 28799, 38799];\n',
    '',
    "electron fallback ports",
  );
  source = literal(
    source,
    'let SERVER_PORT = PACKAGED_HARNESS_PORTS[0];',
    'let SERVER_PORT = 0;',
    "electron initial server port",
  );
  source = literal(
    source,
    '    for (const name of MANAGED_SECRET_ENV) delete environment[name];\n',
    '    for (const name of MANAGED_SECRET_ENV) delete environment[name];\n    delete environment.CUMEA_STATIC_DIR;\n',
    "electron API-only child environment",
  );
  source = literal(
    source,
    '    CUMEA_PORT: String(SERVER_PORT),',
    '    CUMEA_PORT: "0",',
    "electron OS-assigned port request",
  );

  source = regexOnce(
    source,
    /\/\/ P0\.03a deliberately keeps the current bounded health probe[\s\S]*?\nasync function stopServerProcess/,
    `// Packaged startup owns the child process and learns its private port only\n// through UtilityProcess messaging. No TCP/HTTP discovery probe participates\n// in readiness.\nasync function startServerProcess() {\n  if (isQuitting) return null;\n  const entry = path.join(process.resourcesPath, "server", "index.js");\n  const proc = utilityProcess.fork(entry, [], {\n    env: serverEnvironment(),\n    stdio: "inherit",\n  });\n  serverProc = proc;\n  proc.once("exit", () => {\n    if (serverProc === proc) {\n      serverProc = null;\n      serverReady = false;\n      if (!isQuitting) desktopGateway?.clearHarnessTarget("agent host could not start");\n    }\n  });\n\n  try {\n    const ready = await waitForHarnessReady(proc, { timeoutMs: 30_000 });\n    if (isQuitting || serverProc !== proc) {\n      try {\n        proc.kill();\n      } catch {}\n      return null;\n    }\n    SERVER_PORT = ready.port;\n    return { proc, port: ready.port };\n  } catch (error) {\n    if (serverProc === proc) serverProc = null;\n    try {\n      proc.kill();\n    } catch {}\n    if (!isQuitting) desktopGateway?.clearHarnessTarget("agent host could not start");\n    console.error("[server] readiness failed:", error);\n    return null;\n  }\n}\n\nasync function startServerPackaged() {\n  const started = await startServerProcess();\n  if (!started || isQuitting || serverProc !== started.proc) {\n    serverReady = false;\n    if (!isQuitting) desktopGateway?.clearHarnessTarget("agent host could not start");\n    return false;\n  }\n  serverReady = true;\n  desktopGateway?.setHarnessTarget(started.port);\n  return true;\n}\n\nasync function stopServerProcess`,
    "electron packaged startup control plane",
  );

  source = regexOnce(
    source,
    /async function restartServerForCredentials\(\) \{[\s\S]*?\n\}\n\nconst ERROR_PAGE/,
    `async function restartServerForCredentials() {\n  if (!app.isPackaged) {\n    throw new Error("secure credential updates require the packaged desktop host");\n  }\n  if (isQuitting) throw new Error("Cumea is shutting down");\n  return queueServerTransition(async () => {\n    if (isQuitting) throw new Error("Cumea is shutting down");\n    await stopServerProcess("agent host is restarting");\n    await delay(100);\n    const started = await startServerProcess();\n    if (!started || isQuitting || serverProc !== started.proc) {\n      if (!isQuitting) desktopGateway?.clearHarnessTarget("agent host could not start");\n      throw new Error("the agent host could not restart");\n    }\n    const response = await fetch(\`http://127.0.0.1:\${started.port}/api/config\`);\n    if (!response.ok) {\n      await stopServerProcess("agent host could not start");\n      throw new Error("the restarted agent host did not return configuration status");\n    }\n    const config = await response.json();\n    if (isQuitting || serverProc !== started.proc) {\n      await stopServerProcess("agent host could not start");\n      throw new Error("the restarted agent host exited before activation");\n    }\n    SERVER_PORT = started.port;\n    serverReady = true;\n    desktopGateway?.setHarnessTarget(started.port);\n    return config;\n  });\n}\n\nconst ERROR_PAGE`,
    "electron credential restart handshake",
  );

  for (const forbidden of ["PACKAGED_HARNESS_PORTS", "/api/health", "startServerOn("]) {
    if (source.includes(forbidden)) throw new Error(`electron legacy startup primitive remains: ${forbidden}`);
  }
  for (const invariant of [
    'CUMEA_PORT: "0"',
    "waitForHarnessReady(proc",
    "serverProc !== proc",
    "desktopGateway?.setHarnessTarget(started.port)",
  ]) {
    if (!source.includes(invariant)) throw new Error(`electron invariant missing: ${invariant}`);
  }
  return source;
});

edit("package.json", (input) => {
  const document = JSON.parse(input);
  const current = document.scripts?.["test:performance"];
  if (typeof current !== "string") throw new Error("package test:performance is missing");
  if (!current.includes("electron/harness-process.mjs")) {
    document.scripts["test:performance"] = current
      .replace(
        "node --check electron/desktop-gateway.mjs",
        "node --check electron/desktop-gateway.mjs && node --check electron/harness-process.mjs",
      )
      .replace(
        "electron/desktop-gateway.test.mjs scripts/perf-lib.test.mjs",
        "electron/desktop-gateway.test.mjs electron/harness-process.test.mjs scripts/perf-lib.test.mjs",
      );
  }
  return `${JSON.stringify(document, null, 2)}\n`;
});
