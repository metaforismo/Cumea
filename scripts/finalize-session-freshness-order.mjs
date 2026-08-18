import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

replaceOnce(
  "server/index.ts",
  `  const userMessage = store.appendMessage(bot.threadId, {`,
  `  // Capture prior trust before changing it, then persist pending before the
  // new user message itself becomes canonical. If anything fails after this
  // point, a later turn rebuilds rather than trusting an older native cursor.
  const previousSelection = sessionFreshness.get(bot.threadId);
  sessionFreshness.begin(bot.threadId, selection);

  const userMessage = store.appendMessage(bot.threadId, {`,
  "pending before canonical user message",
);
replaceOnce(
  "server/index.ts",
  `  const transcript = boundedTurnTranscript(store.messagesFor(bot.threadId), userMessage.id);
  const previousSelection = sessionFreshness.get(bot.threadId);
  const turnContext = decideTurnContext({`,
  `  const transcript = boundedTurnTranscript(store.messagesFor(bot.threadId), userMessage.id);
  const turnContext = decideTurnContext({`,
  "reuse captured previous freshness",
);
replaceOnce(
  "server/index.ts",
  `      // Persist pending before the adapter can create/resume a native
      // session. A crash before session.started therefore cannot make an old
      // cursor appear fresh after restart.
      sessionFreshness.begin(bot.threadId, selection);
      const started = await instance.adapter.sendTurn({`,
  `      const started = await instance.adapter.sendTurn({`,
  "remove late pending write",
);
replaceOnce(
  "server/index.ts",
  `      if (event.sessionId && event.providerInstanceId) {
        store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
        try {
          sessionFreshness.confirm(event.threadId, event.providerInstanceId);
        } catch (error) {
          // A failed private metadata write must never invalidate the provider
          // event or transcript. The still-pending record causes a safe
          // canonical rebuild on the next turn/restart.
          console.error("session freshness confirmation could not be persisted", error);
        }
      }`,
  `      if (event.sessionId && event.providerInstanceId) {
        // Cursor receipt alone is not enough to declare the session fresh: a
        // native runtime can announce its session before it has incorporated
        // the current user turn. Confirmation happens only on successful
        // turn.completed below.
        store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
      }`,
  "defer freshness confirmation",
);
replaceOnce(
  "server/index.ts",
  `    case "turn.completed": {
      // the last live frame becomes a settled inline screen message —`,
  `    case "turn.completed": {
      if (event.ok && event.providerInstanceId) {
        try {
          sessionFreshness.confirm(event.threadId, event.providerInstanceId);
        } catch (error) {
          // Leaving the private state pending is conservative: the next turn
          // rebuilds canonical history instead of trusting a cursor whose
          // completion could not be durably confirmed.
          console.error("session freshness completion could not be persisted", error);
        }
      }
      // the last live frame becomes a settled inline screen message —`,
  "confirm on successful turn completion",
);

replaceOnce(
  "server/session-freshness.ts",
  `  /** Persist before handing a turn to a native provider. If the process dies
   * before session.started confirms the new/resumed session, a later launch
   * sees \`pending\` and rebuilds from canonical history instead of trusting an
   * older cursor left in bots.json. */`,
  `  /** Persist before the new user turn becomes canonical. If the process dies
   * before a successful turn.completed confirms the new/resumed session, a
   * later launch sees \`pending\` and rebuilds from canonical history instead
   * of trusting an older cursor left in bots.json. */`,
  "freshness begin documentation",
);
replaceOnce(
  "server/session-freshness.ts",
  `  /** Confirm only the instance that actually announced session.started. The
   * selected model comes from the pending dispatch record so a settings edit
   * during the in-flight turn cannot relabel that session. */`,
  `  /** Confirm only the instance whose turn actually completed successfully.
   * The selected model comes from the pending dispatch record so a settings
   * edit during the in-flight turn cannot relabel that session. */`,
  "freshness confirm documentation",
);

for (const needle of [
  "sessionFreshness.begin(bot.threadId, selection)",
  "sessionFreshness.confirm(event.threadId, event.providerInstanceId)",
  "Cursor receipt alone is not enough",
  "successful turn.completed",
]) {
  if (!readFileSync("server/index.ts", "utf8").includes(needle) && !readFileSync("server/session-freshness.ts", "utf8").includes(needle)) {
    throw new Error(`missing invariant: ${needle}`);
  }
}
const index = readFileSync("server/index.ts", "utf8");
if (index.indexOf("sessionFreshness.begin(bot.threadId, selection)") > index.indexOf("const userMessage = store.appendMessage")) {
  throw new Error("pending freshness must precede canonical user-message append");
}
