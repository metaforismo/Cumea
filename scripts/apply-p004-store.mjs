import { readFileSync, writeFileSync } from "node:fs";

const path = "src/state/store.tsx";
let source = readFileSync(path, "utf8");

function literal(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) {
    throw new Error(`${label}: expected exactly one match`);
  }
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

function regexOnce(pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`${label}: expected exactly one match`);
  source = source.replace(pattern, replacement);
}

literal(
  'import { cardResponseDecision } from "./response-decision";\n',
  `import { cardResponseDecision } from "./response-decision";\nimport {\n  framesAfterCursor,\n  materializeDesktopBootstrap,\n  parseCursorFrame,\n  type CursorFrame,\n  type DesktopBootstrap,\n} from "./bootstrap-sync";\n`,
  "bootstrap sync import",
);

literal(
  'type Action =\n  | { type: "hydrate"; bots: Bot[] }',
  `type Action =\n  | {\n      type: "bootstrap";\n      bots: Bot[];\n      selectedId: string;\n      instances: InstanceInfo[];\n      config: ConfigStatus;\n      workspace: WorkspaceSnapshot;\n    }\n  | { type: "hydrate"; bots: Bot[] }`,
  "bootstrap action",
);

literal(
  '  switch (action.type) {\n    case "hydrate": {',
  `  switch (action.type) {\n    case "bootstrap":\n      return {\n        ...state,\n        bots: action.bots,\n        selectedId: action.selectedId,\n        instances: action.instances,\n        config: action.config,\n        workspace: action.workspace,\n      };\n    case "hydrate": {`,
  "bootstrap reducer",
);

literal(
  '  const pendingBotDeletes = useRef(new Map<string, string>());\n',
  `  const pendingBotDeletes = useRef(new Map<string, string>());\n  const workspaceCompleteRef = useRef(false);\n`,
  "workspace completeness ref",
);

literal(
  '        case "updateBot": {\n',
  `        case "toggleWork": {\n          const opening = action.open ?? !stateRef.current.workOpen;\n          if (opening && !workspaceCompleteRef.current) {\n            api("/api/work")\n              .then(({ workspace }) => {\n                workspaceCompleteRef.current = true;\n                rawDispatch({ type: "workspaceHydrated", workspace });\n              })\n              .catch(showError);\n          }\n          break;\n        }\n        case "updateBot": {\n`,
  "lazy full workspace reload",
);

regexOnce(
  /  \/\/ ── initial load \+ SSE fold ─[\s\S]*?\n  \}, \[\]\);/,
  `  // ── atomic bootstrap + cursor-aware SSE fold ───────────────────────\n  useEffect(() => {\n    let alive = true;\n    let syncing = true;\n    let syncGeneration = 0;\n    let lastCursor = 0;\n    let buffered: CursorFrame[] = [];\n    let bufferOverflow = false;\n    let retryTimer: ReturnType<typeof setTimeout> | null = null;\n    const MAX_BUFFERED_FRAMES = 2_048;\n\n    const applyFrame = (cursorFrame: CursorFrame) => {\n      const frame = cursorFrame as any;\n      switch (frame.kind) {\n        case "message":\n          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message });\n          break;\n        case "message.patch":\n          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message });\n          break;\n        case "bot": {\n          const bot = frame.bot as Partial<Bot> & { id: string };\n          if (bot.unread && bot.id === stateRef.current.selectedId) {\n            bot.unread = false;\n            fetch(\`/api/bots/\${bot.id}\`, {\n              method: "PATCH",\n              headers: { "content-type": "application/json" },\n              body: JSON.stringify({ unread: false }),\n            }).catch(() => {});\n          }\n          rawDispatch({ type: "botPatched", bot });\n          break;\n        }\n        case "runtime": {\n          const event = frame.event;\n          if (event.type === "content.delta" && event.streamKind === "assistant_text") {\n            rawDispatch({ type: "streamDelta", threadId: event.threadId, delta: event.delta });\n          } else if (event.type === "turn.completed") {\n            rawDispatch({ type: "streamClear", threadId: event.threadId });\n          }\n          break;\n        }\n        case "screen":\n          rawDispatch({ type: "screenFrame", botId: frame.botId, png: frame.png, mime: frame.mime ?? "image/png" });\n          break;\n        case "computer":\n          rawDispatch({ type: "provisioning", botId: frame.botId, on: frame.state === "provisioning" });\n          break;\n        case "workspace":\n          workspaceCompleteRef.current = true;\n          rawDispatch({ type: "workspaceHydrated", workspace: frame.workspace });\n          break;\n        case "bot.deleted":\n          if (\n            typeof frame.operationId !== "string" ||\n            pendingBotDeletes.current.get(frame.botId) !== frame.operationId\n          ) {\n            rawDispatch({ type: "botDeleted", botId: frame.botId });\n          }\n          break;\n        case "config":\n          rawDispatch({\n            type: "configStatus",\n            config: { xai: frame.xai, composio: frame.composio, box: frame.box, profile: frame.profile },\n          });\n          api("/api/instances")\n            .then(({ instances }) => rawDispatch({ type: "instances", instances }))\n            .catch(() => {});\n          break;\n      }\n    };\n\n    const queueFrame = (frame: CursorFrame) => {\n      if (syncing) {\n        if (buffered.length >= MAX_BUFFERED_FRAMES) {\n          bufferOverflow = true;\n          return;\n        }\n        buffered.push(frame);\n        return;\n      }\n      if (frame.eventCursor <= lastCursor) return;\n      lastCursor = frame.eventCursor;\n      applyFrame(frame);\n    };\n\n    const startBootstrap = () => {\n      const generation = ++syncGeneration;\n      syncing = true;\n      buffered = [];\n      bufferOverflow = false;\n      if (retryTimer) {\n        clearTimeout(retryTimer);\n        retryTimer = null;\n      }\n      const requestedSelectedId = stateRef.current.selectedId;\n      const query = new URLSearchParams();\n      if (requestedSelectedId) query.set("selectedBotId", requestedSelectedId);\n      const path = \`/api/bootstrap\${query.size ? \`?\${query.toString()}\` : ""}\`;\n\n      void api(path)\n        .then((snapshot: DesktopBootstrap) => {\n          if (!alive || generation !== syncGeneration) return;\n          if (\n            requestedSelectedId &&\n            stateRef.current.selectedId &&\n            stateRef.current.selectedId !== requestedSelectedId\n          ) {\n            startBootstrap();\n            return;\n          }\n          const materialized = materializeDesktopBootstrap(snapshot);\n          workspaceCompleteRef.current = materialized.workspaceComplete;\n          rawDispatch({\n            type: "bootstrap",\n            bots: materialized.bots,\n            selectedId: materialized.selectedId,\n            instances: snapshot.instances,\n            config: snapshot.config,\n            workspace: materialized.workspace,\n          });\n          lastCursor = snapshot.eventCursor;\n          const pending = framesAfterCursor(buffered, lastCursor);\n          const overflowed = bufferOverflow;\n          buffered = [];\n          bufferOverflow = false;\n          syncing = false;\n          if (overflowed) {\n            startBootstrap();\n            return;\n          }\n          for (const frame of pending) {\n            if (frame.eventCursor <= lastCursor) continue;\n            lastCursor = frame.eventCursor;\n            applyFrame(frame);\n          }\n        })\n        .catch(() => {\n          if (!alive || generation !== syncGeneration) return;\n          retryTimer = setTimeout(startBootstrap, 500);\n        });\n    };\n\n    const es = new EventSource("/api/events");\n    es.onopen = () => rawDispatch({ type: "connected", value: true });\n    es.onerror = () => {\n      rawDispatch({ type: "connected", value: false });\n      syncGeneration += 1;\n      syncing = true;\n      buffered = [];\n      bufferOverflow = false;\n      if (retryTimer) {\n        clearTimeout(retryTimer);\n        retryTimer = null;\n      }\n    };\n    es.onmessage = (raw) => {\n      let value: unknown;\n      try {\n        value = JSON.parse(raw.data);\n      } catch {\n        startBootstrap();\n        return;\n      }\n      if (value && typeof value === "object" && !Array.isArray(value) && (value as any).kind === "hello") {\n        rawDispatch({ type: "connected", value: true });\n        startBootstrap();\n        return;\n      }\n      const frame = parseCursorFrame(value);\n      if (!frame) {\n        startBootstrap();\n        return;\n      }\n      queueFrame(frame);\n    };\n\n    return () => {\n      alive = false;\n      syncGeneration += 1;\n      if (retryTimer) clearTimeout(retryTimer);\n      es.close();\n    };\n  }, []);`,
  "initial load/SSE effect",
);

for (const forbidden of ['api("/api/bots")\n        .then', 'loadAll(); // resync']) {
  if (source.includes(forbidden)) throw new Error(`legacy initial load remains: ${forbidden}`);
}
for (const invariant of [
  'type: "bootstrap"',
  'MAX_BUFFERED_FRAMES = 2_048',
  'materializeDesktopBootstrap(snapshot)',
  'framesAfterCursor(buffered, lastCursor)',
  'query.set("selectedBotId", requestedSelectedId)',
]) {
  if (!source.includes(invariant)) throw new Error(`missing renderer invariant: ${invariant}`);
}

writeFileSync(path, source);
