import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`${label}: expected exactly one source match`);
  }
  return source.replace(pattern, replacement);
}

function replaceLiteralOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  const last = source.lastIndexOf(needle);
  if (first < 0 || first !== last) {
    throw new Error(`${label}: expected exactly one literal source match`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

const mainFile = "electron/main.mjs";
let main = readFileSync(mainFile, "utf8");

main = replaceLiteralOnce(
  main,
  `import {\n  createDesktopGateway,\n  DEFAULT_DESKTOP_GATEWAY_PORT,\n} from "./desktop-gateway.mjs";\n`,
  `import {\n  createDesktopGateway,\n  DEFAULT_DESKTOP_GATEWAY_PORT,\n} from "./desktop-gateway.mjs";\nimport { waitForHarnessReady } from "./harness-process.mjs";\n`,
  "harness readiness import",
);
main = replaceLiteralOnce(
  main,
  'const PACKAGED_HARNESS_PORTS = [18799, 28799, 38799];\n',
  "",
  "fixed harness port list",
);
main = replaceLiteralOnce(
  main,
  'let SERVER_PORT = PACKAGED_HARNESS_PORTS[0];',
  'let SERVER_PORT = 0;',
  "initial private harness port",
);
main = replaceLiteralOnce(
  main,
  '    CUMEA_PORT: String(SERVER_PORT),',
  '    CUMEA_PORT: "0",',
  "OS-assigned harness request",
);

main = replaceOnce(
  main,
  /\/\/ P0\.03a deliberately keeps[\s\S]*?\nasync function stopServerProcess/,
  `// The local harness now asks the OS for a private port and announces that\n// exact bound port through UtilityProcess messaging. No HTTP request is used\n// to discover readiness or identity.\nasync function startServerProcess() {\n  if (isQuitting) return null;\n  const entry = path.join(process.resourcesPath, "server", "index.js");\n  const proc = utilityProcess.fork(entry, [], {\n    env: serverEnvironment(),\n    stdio: "inherit",\n  });\n  serverProc = proc;\n  let announced = false;\n  proc.once("exit", () => {\n    if (serverProc !== proc) return;\n    serverProc = null;\n    serverReady = false;\n    if (!isQuitting) {\n      desktopGateway?.clearHarnessTarget(\n        announced ? "agent host could not start" : "agent host is starting",\n      );\n    }\n  });\n\n  try {\n    const ready = await waitForHarnessReady(proc);\n    announced = true;\n    if (isQuitting || serverProc !== proc) {\n      try {\n        proc.kill();\n      } catch {}\n      return null;\n    }\n    SERVER_PORT = ready.port;\n    return proc;\n  } catch (error) {\n    if (serverProc === proc) serverProc = null;\n    try {\n      proc.kill();\n    } catch {}\n    throw error;\n  }\n}\n\nasync function startServerPackaged() {\n  if (isQuitting) return false;\n  const proc = await startServerProcess();\n  if (!proc || isQuitting) return false;\n  serverReady = true;\n  desktopGateway?.setHarnessTarget(SERVER_PORT);\n  return true;\n}\n\nasync function stopServerProcess`,
  "replace readiness polling control plane",
);

main = replaceOnce(
  main,
  /async function restartServerForCredentials\(\) \{[\s\S]*?\n\}\n\nconst ERROR_PAGE/,
  `async function restartServerForCredentials() {\n  if (!app.isPackaged) {\n    throw new Error("secure credential updates require the packaged desktop host");\n  }\n  if (isQuitting) throw new Error("Cumea is shutting down");\n  return queueServerTransition(async () => {\n    if (isQuitting) throw new Error("Cumea is shutting down");\n    await stopServerProcess("agent host is restarting");\n    await delay(100);\n    let proc;\n    try {\n      proc = await startServerProcess();\n    } catch (error) {\n      if (!isQuitting) desktopGateway?.clearHarnessTarget("agent host could not start");\n      throw error;\n    }\n    if (!proc) {\n      if (!isQuitting) desktopGateway?.clearHarnessTarget("agent host could not start");\n      throw new Error("the agent host could not restart");\n    }\n\n    const port = SERVER_PORT;\n    const response = await fetch(\`http://127.0.0.1:\${port}/api/config\`);\n    if (!response.ok) {\n      await stopServerProcess("agent host could not start");\n      throw new Error("the restarted agent host did not return configuration status");\n    }\n    const config = await response.json();\n    if (isQuitting) throw new Error("Cumea is shutting down");\n    serverReady = true;\n    desktopGateway?.setHarnessTarget(port);\n    return config;\n  });\n}\n\nconst ERROR_PAGE`,
  "credential restart on announced port",
);

if (main.includes("PACKAGED_HARNESS_PORTS")) {
  throw new Error("fixed harness fallback ports remain in Electron main");
}
if (main.includes("/api/health")) {
  throw new Error("HTTP readiness probe remains in Electron main");
}
if (!main.includes('CUMEA_PORT: "0"')) {
  throw new Error("Electron no longer requests an OS-assigned local port");
}
if (!main.includes("await waitForHarnessReady(proc)")) {
  throw new Error("UtilityProcess readiness handshake is not active");
}
writeFileSync(mainFile, main);

const packageFile = "package.json";
let packageSource = readFileSync(packageFile, "utf8");
packageSource = replaceLiteralOnce(
  packageSource,
  'node --check electron/desktop-gateway.mjs && node --check scripts/perf-desktop.mjs && node --test electron/performance.test.mjs electron/desktop-gateway.test.mjs scripts/perf-lib.test.mjs scripts/perf-desktop.test.mjs',
  'node --check electron/desktop-gateway.mjs && node --check electron/harness-process.mjs && node --check scripts/perf-desktop.mjs && node --test electron/performance.test.mjs electron/desktop-gateway.test.mjs electron/harness-process.test.mjs scripts/perf-lib.test.mjs scripts/perf-desktop.test.mjs',
  "performance script readiness coverage",
);
writeFileSync(packageFile, packageSource);
