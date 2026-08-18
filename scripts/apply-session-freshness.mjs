import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

// Harness imports + private freshness store.
replaceOnce(
  "server/index.ts",
  'import { PairingStore } from "./pairing.ts";\nimport { mentionedBots, parseBotAvatar, Store, type Message } from "./store.ts";',
  'import { PairingStore } from "./pairing.ts";\nimport { SessionFreshnessStore } from "./session-freshness.ts";\nimport { mentionedBots, parseBotAvatar, Store, type Message } from "./store.ts";',
  "index freshness import",
);
replaceOnce(
  "server/index.ts",
  '} from "./transcript-navigation.ts";\nimport { readThreadInspector } from "./thread-inspector.ts";',
  '} from "./transcript-navigation.ts";\nimport { boundedTurnTranscript, decideTurnContext } from "./turn-context.ts";\nimport { readThreadInspector } from "./thread-inspector.ts";',
  "index turn-context import",
);
replaceOnce(
  "server/index.ts",
  'const store = new Store(() => bootSelection, { messageSearch: true, transcripts: true });\nconst workspace = new WorkspaceStore();',
  'const store = new Store(() => bootSelection, { messageSearch: true, transcripts: true });\nconst sessionFreshness = new SessionFreshnessStore(ATTACHMENTS_DIR.slice(0, -"attachments".length).replace(/[\\\\/]$/, ""));\nconst workspace = new WorkspaceStore();',
  "index freshness store",
);
// Replace the awkward data-dir derivation above immediately with the canonical config export.
replaceOnce(
  "server/index.ts",
  'import { ATTACHMENTS_DIR, ensureDirs, instanceConfigs, loadConfig, saveConfig, EVENTS_DIR, NATIVE_DIR } from "./config.ts";',
  'import { ATTACHMENTS_DIR, DATA_DIR, ensureDirs, instanceConfigs, loadConfig, saveConfig, EVENTS_DIR, NATIVE_DIR } from "./config.ts";',
  "index DATA_DIR import",
);
replaceOnce(
  "server/index.ts",
  'const sessionFreshness = new SessionFreshnessStore(ATTACHMENTS_DIR.slice(0, -"attachments".length).replace(/[\\\\/]$/, ""));',
  'const sessionFreshness = new SessionFreshnessStore(DATA_DIR);',
  "index freshness DATA_DIR",
);

// Capture the selection at request start so a settings edit during a live turn
// applies only to the next turn, never half-way through this dispatch.
replaceOnce(
  "server/index.ts",
  '  const commsDepth = opts.commsDepth ?? 0;\n  const attachments = opts.attachments ?? [];',
  '  const commsDepth = opts.commsDepth ?? 0;\n  const attachments = opts.attachments ?? [];\n  const selection = { ...bot.modelSelection };',
  "capture selection",
);
replaceOnce(
  "server/index.ts",
  '  const instance = registry.get(bot.modelSelection.instanceId);\n  if (!instance) {\n    const message = `provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`;',
  '  const instance = registry.get(selection.instanceId);\n  if (!instance) {\n    const message = `provider instance "${selection.instanceId}" is unavailable — pick another model in settings`;',
  "selected instance",
);
replaceOnce(
  "server/index.ts",
  '  // transcript for API-backed drivers: settled text turns only\n  const transcript = store\n    .messagesFor(bot.threadId)\n    .filter((m) => m.kind === "text" && m.text && m.id !== userMessage.id)\n    .slice(-40)\n    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), text: m.text! }));',
  '  const transcript = boundedTurnTranscript(store.messagesFor(bot.threadId), userMessage.id);\n  const previousSelection = sessionFreshness.get(bot.threadId);\n  const turnContext = decideTurnContext({\n    selectedInstanceId: selection.instanceId,\n    selectedModel: selection.model,\n    sessionModelSwitch: instance.adapter.capabilities.sessionModelSwitch,\n    lastDispatchedInstanceId: previousSelection?.instanceId,\n    lastDispatchedModel: previousSelection?.model,\n    resumeCursors: bot.resumeCursors,\n    transcript,\n  });',
  "bounded turn context",
);
replaceOnce(
  "server/index.ts",
  '        model: bot.modelSelection.model,\n        resumeCursor: bot.resumeCursors[bot.modelSelection.instanceId],\n        transcript,',
  '        model: selection.model,\n        resumeCursor: turnContext.resumeCursor,\n        transcript: turnContext.transcript,\n        rebuildContext: turnContext.rebuildContext,',
  "send freshness context",
);
replaceOnce(
  "server/index.ts",
  '      if (runId) {\n        workspace.bindTurn(runId, started.turnId);',
  '      try {\n        sessionFreshness.mark(bot.threadId, selection);\n      } catch (freshnessError) {\n        console.error("session freshness state could not be persisted; next turn will rebuild if ambiguous", freshnessError);\n      }\n      if (runId) {\n        workspace.bindTurn(runId, started.turnId);',
  "mark dispatched selection",
);
replaceOnce(
  "server/index.ts",
  '  await registry.disposeAll();\n  await registry.load(instanceConfigs(cfg));',
  '  await registry.disposeAll();\n  // The provider fleet identity/configuration changed. Persisted native cursors\n  // may still exist on disk/provider side, but we deliberately stop trusting\n  // them until canonical history has rebuilt a fresh selected session.\n  sessionFreshness.invalidateAll();\n  for (const bot of store.bots) bot.resumeCursors = {};\n  try {\n    for (const bot of store.bots) store.patchBot(bot.id, { resumeCursors: {} });\n  } catch (error) {\n    console.error("could not persist provider-session invalidation", error);\n  }\n  await registry.load(instanceConfigs(cfg));',
  "reload invalidation",
);
replaceOnce(
  "server/index.ts",
  '      broadcast(\n        { kind: "bot.deleted", botId: bot.id, ...(operationId ? { operationId } : {}) },',
  '      try { sessionFreshness.delete(bot.threadId); } catch (error) { console.error("could not remove session freshness metadata", error); }\n      broadcast(\n        { kind: "bot.deleted", botId: bot.id, ...(operationId ? { operationId } : {}) },',
  "delete freshness",
);

// Claude: rebuild means a new session and a canonical-history user prompt.
replaceOnce(
  "server/drivers/claude.ts",
  'import { appendNative } from "./native.ts";',
  'import { appendNative } from "./native.ts";\nimport { nativeTurnText } from "../turn-context.ts";',
  "claude turn context import",
);
replaceOnce(
  "server/drivers/claude.ts",
  '      const sessionId = typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;',
  '      const sessionId = !turn.rebuildContext && typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;',
  "claude stale resume guard",
);
replaceOnce(
  "server/drivers/claude.ts",
  '      const promptMsg = { type: "user", message: { role: "user", content: turn.text } };',
  '      const promptMsg = { type: "user", message: { role: "user", content: nativeTurnText(turn) } };',
  "claude rebuild prompt",
);

// ACP: no session/load during rebuild, and give support hooks the rebuilt user text.
replaceOnce(
  "server/drivers/acp/core.ts",
  'import { appendNative } from "../native.ts";',
  'import { appendNative } from "../native.ts";\nimport { nativeTurnText } from "../../turn-context.ts";',
  "acp turn context import",
);
replaceOnce(
  "server/drivers/acp/core.ts",
  '            const cursor = typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;',
  '            const cursor = !turn.rebuildContext && typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;',
  "acp stale resume guard",
);
replaceOnce(
  "server/drivers/acp/core.ts",
  '            const text = support.buildPromptText\n              ? support.buildPromptText(turn)\n              : turn.system\n                ? `${turn.system}\\n\\n${turn.text}`\n                : turn.text;',
  '            const rebuiltText = nativeTurnText(turn);\n            const promptTurn = rebuiltText === turn.text ? turn : { ...turn, text: rebuiltText };\n            const text = support.buildPromptText\n              ? support.buildPromptText(promptTurn)\n              : turn.system\n                ? `${turn.system}\\n\\n${rebuiltText}`\n                : rebuiltText;',
  "acp rebuild prompt",
);

// Codex: no thread/resume during rebuild; start a new thread with quoted history.
replaceOnce(
  "server/drivers/codex.ts",
  'import { appendNative } from "./native.ts";',
  'import { appendNative } from "./native.ts";\nimport { nativeTurnText } from "../turn-context.ts";',
  "codex turn context import",
);
replaceOnce(
  "server/drivers/codex.ts",
  '          const cursor = typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;',
  '          const cursor = !turn.rebuildContext && typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;',
  "codex stale resume guard",
);
replaceOnce(
  "server/drivers/codex.ts",
  '          await request("turn/start", {\n            threadId: codexThreadId,\n            input: [{ type: "text", text: turn.system ? `${turn.system}\\n\\n${turn.text}` : turn.text }],\n          });',
  '          const userText = nativeTurnText(turn);\n          await request("turn/start", {\n            threadId: codexThreadId,\n            input: [{ type: "text", text: turn.system ? `${turn.system}\\n\\n${userText}` : userText }],\n          });',
  "codex rebuild prompt",
);

for (const [path, needles] of Object.entries({
  "server/index.ts": ["SessionFreshnessStore", "decideTurnContext", "turnContext.rebuildContext", "sessionFreshness.mark", "sessionFreshness.invalidateAll"],
  "server/drivers/claude.ts": ["nativeTurnText(turn)", "!turn.rebuildContext"],
  "server/drivers/acp/core.ts": ["const rebuiltText = nativeTurnText(turn)", "!turn.rebuildContext"],
  "server/drivers/codex.ts": ["const userText = nativeTurnText(turn)", "!turn.rebuildContext"],
})) {
  const text = readFileSync(path, "utf8");
  for (const needle of needles) if (!text.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
