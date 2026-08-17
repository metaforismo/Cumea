import { readFileSync, writeFileSync } from "node:fs";

const path = "src/state/store.tsx";
let source = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceOnce(
  '  materializeDesktopBootstrap,\n  parseCursorFrame,',
  '  materializeDesktopBootstrap,\n  mergeThreadMessages,\n  parseCursorFrame,',
  "message merge import",
);

replaceOnce(
  '  | { type: "messageAdded"; threadId: string; message: Message }\n',
  '  | { type: "messageAdded"; threadId: string; message: Message }\n  | { type: "messagesHydrated"; threadId: string; messages: Message[] }\n',
  "messagesHydrated action",
);

replaceOnce(
  '    case "messageAdded": {\n',
  `    case "messagesHydrated": {\n      const bot = state.bots.find((candidate) => candidate.threadId === action.threadId);\n      if (!bot) return state;\n      return updateBot(state, bot.id, (candidate) => ({\n        ...candidate,\n        messages: mergeThreadMessages(candidate.messages, action.messages),\n      }));\n    }\n    case "messageAdded": {\n`,
  "messagesHydrated reducer",
);

replaceOnce(
  '  const workspaceReloadInFlightRef = useRef(false);\n',
  '  const workspaceReloadInFlightRef = useRef(false);\n  const loadedThreadsRef = useRef(new Set<string>());\n  const loadingThreadsRef = useRef(new Set<string>());\n',
  "thread hydration refs",
);

replaceOnce(
  `        case "select": {\n          const bot = stateRef.current.bots.find((b) => b.id === action.id);\n          if (bot?.unread) {\n            api(\`/api/bots/\${action.id}\`, { method: "PATCH", body: JSON.stringify({ unread: false }) }).catch(() => {});\n          }\n          break;\n        }\n`,
  `        case "select": {\n          const bot = stateRef.current.bots.find((b) => b.id === action.id);\n          if (bot?.unread) {\n            api(\`/api/bots/\${action.id}\`, { method: "PATCH", body: JSON.stringify({ unread: false }) }).catch(() => {});\n          }\n          if (\n            bot &&\n            !loadedThreadsRef.current.has(bot.threadId) &&\n            !loadingThreadsRef.current.has(bot.threadId)\n          ) {\n            loadingThreadsRef.current.add(bot.threadId);\n            api(\`/api/bots/\${bot.id}/messages?limit=80\`)\n              .then(({ messages }) => {\n                loadedThreadsRef.current.add(bot.threadId);\n                rawDispatch({ type: "messagesHydrated", threadId: bot.threadId, messages });\n              })\n              .catch(showError)\n              .finally(() => loadingThreadsRef.current.delete(bot.threadId));\n          }\n          break;\n        }\n`,
  "select lazy transcript load",
);

replaceOnce(
  `          const materialized = materializeDesktopBootstrap(snapshot);\n          workspaceCompleteRef.current = materialized.workspaceComplete;\n          bootstrapReadyRef.current = true;\n`,
  `          const materialized = materializeDesktopBootstrap(snapshot);\n          workspaceCompleteRef.current = materialized.workspaceComplete;\n          bootstrapReadyRef.current = true;\n          loadedThreadsRef.current = new Set(snapshot.selected ? [snapshot.selected.threadId] : []);\n          loadingThreadsRef.current.clear();\n`,
  "bootstrap selected thread ownership",
);

for (const invariant of [
  'type: "messagesHydrated"',
  'mergeThreadMessages(candidate.messages, action.messages)',
  'messages?limit=80',
  'loadedThreadsRef.current = new Set',
]) {
  if (!source.includes(invariant)) throw new Error(`missing lazy transcript invariant: ${invariant}`);
}
writeFileSync(path, source);
