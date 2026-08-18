import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

replaceOnce(
  "server/index.ts",
  `    case "session.started":
      if (event.sessionId && event.providerInstanceId) {
        store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
      }
      break;`,
  `    case "session.started":
      if (event.sessionId && event.providerInstanceId) {
        store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
        try {
          sessionFreshness.confirm(event.threadId, event.providerInstanceId);
        } catch (error) {
          // A failed private metadata write must never invalidate the provider
          // event or transcript. The still-pending record causes a safe
          // canonical rebuild on the next turn/restart.
          console.error("session freshness confirmation could not be persisted", error);
        }
      }
      break;`,
  "session started confirmation",
);

replaceOnce(
  "server/index.ts",
  `    sessionInvalidated: previousSelection?.state === "invalidated",
    lastDispatchedInstanceId: previousSelection?.state === "dispatched" ? previousSelection.instanceId : undefined,
    lastDispatchedModel: previousSelection?.state === "dispatched" ? previousSelection.model : undefined,`,
  `    sessionState: previousSelection?.state ?? null,
    lastDispatchedInstanceId: previousSelection?.state === "dispatched" ? previousSelection.instanceId : undefined,
    lastDispatchedModel: previousSelection?.state === "dispatched" ? previousSelection.model : undefined,`,
  "turn context session state",
);

replaceOnce(
  "server/index.ts",
  `      const started = await instance.adapter.sendTurn({`,
  `      // Persist pending before the adapter can create/resume a native
      // session. A crash before session.started therefore cannot make an old
      // cursor appear fresh after restart.
      sessionFreshness.begin(bot.threadId, selection);
      const started = await instance.adapter.sendTurn({`,
  "begin session freshness before dispatch",
);

replaceOnce(
  "server/index.ts",
  `      try {
        sessionFreshness.mark(bot.threadId, selection);
      } catch (freshnessError) {
        console.error("session freshness state could not be persisted; next turn will rebuild if ambiguous", freshnessError);
      }
      if (runId) {`,
  `      if (runId) {`,
  "remove early dispatched mark",
);

for (const needle of [
  'sessionFreshness.confirm(event.threadId, event.providerInstanceId)',
  'sessionState: previousSelection?.state ?? null',
  'sessionFreshness.begin(bot.threadId, selection)',
]) {
  const source = readFileSync("server/index.ts", "utf8");
  if (!source.includes(needle)) throw new Error(`server/index.ts: missing ${needle}`);
}
if (readFileSync("server/index.ts", "utf8").includes("sessionFreshness.mark(bot.threadId")) {
  throw new Error("server/index.ts: stale early session freshness mark remains");
}
