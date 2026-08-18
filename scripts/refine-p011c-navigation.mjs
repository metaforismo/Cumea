import { readFileSync, writeFileSync } from "node:fs";

const path = "src/state/store.tsx";
let source = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceOnce(
  `    if (action.type === "select") {\n      const bot = stateRef.current.bots.find((candidate) => candidate.id === action.id);\n      const threadId = bot?.threadId;\n      if (threadId && !loadedThreadsRef.current.has(threadId)) {\n        loadedThreadsRef.current.add(threadId);\n        void api(\`/api/bots/\${encodeURIComponent(action.id)}/messages?limit=\${BOT_MESSAGE_BOOTSTRAP_LIMIT}\`)\n          .then((body) => {\n            baseDispatch({ type: "messagesHydrated", threadId, messages: body.messages ?? [] });\n          })\n          .catch((error) => {\n            loadedThreadsRef.current.delete(threadId);\n            console.warn("Failed to hydrate selected transcript", error);\n          });\n      }\n    }\n`,
  `    if (action.type === "select") {\n      const current = stateRef.current;\n      const bot = current.bots.find((candidate) => candidate.id === action.id);\n      const threadId = bot?.threadId;\n      const returningFromSearch = current.searchFocus?.botId === action.id;\n      if (threadId && (returningFromSearch || !loadedThreadsRef.current.has(threadId))) {\n        loadedThreadsRef.current.add(threadId);\n        void api(\`/api/bots/\${encodeURIComponent(action.id)}/messages?limit=\${BOT_MESSAGE_BOOTSTRAP_LIMIT}\`)\n          .then((body) => {\n            baseDispatch(\n              returningFromSearch\n                ? { type: "latestMessages", threadId, messages: body.messages ?? [] }\n                : { type: "messagesHydrated", threadId, messages: body.messages ?? [] },\n            );\n          })\n          .catch((error) => {\n            if (!returningFromSearch) loadedThreadsRef.current.delete(threadId);\n            console.warn("Failed to hydrate selected transcript", error);\n          });\n      }\n    }\n`,
  "select returns from historical search window",
);

for (const needle of ["returningFromSearch", 'type: "latestMessages"', "current.searchFocus?.botId"]) {
  if (!source.includes(needle)) throw new Error(`missing invariant: ${needle}`);
}
writeFileSync(path, source);
