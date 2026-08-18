import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

replaceOnce(
  "server/index.ts",
  '    lastDispatchedInstanceId: previousSelection?.instanceId,\n    lastDispatchedModel: previousSelection?.model,',
  '    sessionInvalidated: previousSelection?.state === "invalidated",\n    lastDispatchedInstanceId: previousSelection?.state === "dispatched" ? previousSelection.instanceId : undefined,\n    lastDispatchedModel: previousSelection?.state === "dispatched" ? previousSelection.model : undefined,',
  "freshness union projection",
);
replaceOnce(
  "server/index.ts",
  'async function reloadProviders() {\n  bus.detachAll();\n  await registry.disposeAll();\n  // The provider fleet identity/configuration changed. Persisted native cursors\n  // may still exist on disk/provider side, but we deliberately stop trusting\n  // them until canonical history has rebuilt a fresh selected session.\n  sessionFreshness.invalidateAll();\n  for (const bot of store.bots) bot.resumeCursors = {};\n  try {\n    for (const bot of store.bots) store.patchBot(bot.id, { resumeCursors: {} });\n  } catch (error) {\n    console.error("could not persist provider-session invalidation", error);\n  }\n  await registry.load(instanceConfigs(cfg));',
  'async function reloadProviders() {\n  // Persist the distrust marker before touching the current fleet. If this\n  // owner-local write fails, leave the live providers intact rather than\n  // creating a restart window where an old cursor could be trusted again.\n  sessionFreshness.invalidate(store.bots.map((bot) => bot.threadId));\n  bus.detachAll();\n  await registry.disposeAll();\n  await registry.load(instanceConfigs(cfg));',
  "reload fail-closed invalidation",
);

replaceOnce(
  "server/turn-context.test.ts",
  '  it("rebuilds A to B to A instead of trusting A\'s stale cursor", () => {',
  '  it("rebuilds after an explicit provider-fleet invalidation even when one old cursor remains", () => {\n    expect(decide({\n      sessionInvalidated: true,\n      resumeCursors: { claude: "old-session" },\n    })).toMatchObject({\n      resumeCursor: undefined,\n      rebuildContext: true,\n      reason: "provider-reloaded",\n    });\n  });\n\n  it("rebuilds A to B to A instead of trusting A\'s stale cursor", () => {',
  "provider reload context test",
);

for (const [path, needles] of Object.entries({
  "server/index.ts": ['sessionInvalidated: previousSelection?.state === "invalidated"', 'sessionFreshness.invalidate(store.bots.map((bot) => bot.threadId))'],
  "server/turn-context.test.ts": ['reason: "provider-reloaded"'],
})) {
  const source = readFileSync(path, "utf8");
  for (const needle of needles) if (!source.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
