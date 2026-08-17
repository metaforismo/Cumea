import { readFileSync, writeFileSync } from "node:fs";

const path = "server/index.ts";
let source = readFileSync(path, "utf8");

function literal(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) {
    throw new Error(`${label}: expected exactly one match`);
  }
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

literal(
  'import { writeFileAtomic } from "./atomic.ts";\n',
  'import { writeFileAtomic } from "./atomic.ts";\nimport { buildDesktopBootstrap } from "./bootstrap.ts";\n',
  "bootstrap import",
);

literal(
  'const sseClients = new Map<ServerResponse, SseClient>();\n',
  `const sseClients = new Map<ServerResponse, SseClient>();\nlet localEventCursor = 0;\n\nfunction nextLocalEventCursor(): number {\n  if (localEventCursor >= Number.MAX_SAFE_INTEGER) {\n    throw new Error("local event cursor exhausted");\n  }\n  localEventCursor += 1;\n  return localEventCursor;\n}\n`,
  "local event cursor",
);

literal(
  'function broadcast(payload: unknown, options: BroadcastOptions = {}) {\n  for (const [res, client] of [...sseClients]) {',
  `function broadcast(payload: unknown, options: BroadcastOptions = {}) {\n  const eventCursor = nextLocalEventCursor();\n  for (const [res, client] of [...sseClients]) {`,
  "broadcast cursor increment",
);

literal(
  '    if (outgoing === null) continue;\n    const frame = `data: ${JSON.stringify(outgoing)}\\n\\n`;\n',
  `    if (outgoing === null) continue;\n    const visible =\n      surface === "local" && outgoing && typeof outgoing === "object" && !Array.isArray(outgoing)\n        ? { ...(outgoing as Record<string, unknown>), eventCursor }\n        : outgoing;\n    const frame = \`data: \${JSON.stringify(visible)}\\n\\n\`;\n`,
  "local cursor envelope",
);

literal(
  '      res.write(`data: ${JSON.stringify({ kind: "hello" })}\\n\\n`);\n',
  '      res.write(`data: ${JSON.stringify(surface === "local" ? { kind: "hello", eventCursor: localEventCursor } : { kind: "hello" })}\\n\\n`);\n',
  "SSE hello cursor",
);

const routeNeedle = `    // ── durable work model: sections, tasks, runs, artifacts, routines ──\n    if (method === "GET" && path === "/api/work") {`;
const routeReplacement = `    // ── atomic desktop startup snapshot ───────────────────────────────\n    if (method === "GET" && path === "/api/bootstrap") {\n      if (surface !== "local") return json(res, 403, { error: "desktop bootstrap is local-only" });\n      const rawSelected = url.searchParams.get("selectedBotId");\n      if (rawSelected && !/^[\\w-]{1,100}$/.test(rawSelected)) {\n        return json(res, 400, { error: "invalid selectedBotId" });\n      }\n\n      // Discovery may await provider processes. Do it before the synchronous\n      // snapshot cut; any event after the cut receives a strictly greater\n      // localEventCursor and is replayed by the renderer's buffered SSE fold.\n      const instances = await registry.describe();\n      const workspaceSnapshot = publicWorkspace();\n      const eventCursor = localEventCursor;\n      const needsYouCount = workspaceSnapshot.runs.filter(\n        (run) => run.status === "needs_attention",\n      ).length;\n      const computerStatus = {\n        cloudConfigured: box.boxConfigured(cfg),\n        localConfigured: Boolean(readCuaConnection()),\n      };\n      const snapshot = buildDesktopBootstrap({\n        bots: store.bots,\n        messagesFor: (threadId) => store.messagesFor(threadId),\n        selectedBotId: rawSelected,\n        config: configStatus(),\n        instances,\n        workspace: workspaceSnapshot,\n        needsYouCount,\n        computerStatus,\n        eventCursor,\n      });\n      res.setHeader("cache-control", "no-store");\n      return json(res, 200, snapshot);\n    }\n\n    // ── durable work model: sections, tasks, runs, artifacts, routines ──\n    if (method === "GET" && path === "/api/work") {`;
literal(routeNeedle, routeReplacement, "bootstrap route");

for (const invariant of [
  'buildDesktopBootstrap({',
  'let localEventCursor = 0',
  'eventCursor: localEventCursor',
  'path === "/api/bootstrap"',
  'workspaceSnapshot.runs.filter',
]) {
  if (!source.includes(invariant)) throw new Error(`missing server invariant: ${invariant}`);
}

writeFileSync(path, source);
