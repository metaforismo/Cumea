import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) {
    throw new Error(`${label}: expected one match, found ${first < 0 ? 0 : "multiple"}`);
  }
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

function assertContains(path, needles) {
  const source = readFileSync(path, "utf8");
  for (const needle of needles) {
    if (!source.includes(needle)) throw new Error(`${path}: missing ${needle}`);
  }
}

// Canonical transcript shape + renderer mirror.
replaceOnce(
  "server/store.ts",
  '  png?: string;\n  mime?: string;\n  at: number;\n}',
  '  png?: string;\n  mime?: string;\n  /** Explicit attended user steering persisted while a bot is already busy. */\n  delivery?: "queued" | "failed";\n  at: number;\n}',
  "server Message delivery",
);
replaceOnce(
  "src/state/store.tsx",
  '  png?: string;\n  mime?: string;\n  at: number;\n}',
  '  png?: string;\n  mime?: string;\n  delivery?: "queued" | "failed";\n  at: number;\n}',
  "renderer Message delivery",
);

// Canonical validation fails closed on unknown delivery states.
replaceOnce(
  "server/transcript-store.ts",
  '  if (!Number.isSafeInteger(message.at) || (message.at as number) < 0) {\n    throw statusError(500, `legacy transcript message ${position} has an invalid timestamp`);\n  }\n  return value as Message;',
  '  if (!Number.isSafeInteger(message.at) || (message.at as number) < 0) {\n    throw statusError(500, `legacy transcript message ${position} has an invalid timestamp`);\n  }\n  if (message.delivery !== undefined && message.delivery !== "queued" && message.delivery !== "failed") {\n    throw statusError(500, `legacy transcript message ${position} has an invalid delivery state`);\n  }\n  return value as Message;',
  "canonical delivery validation",
);

// Visible mobile projection keeps only the explicit queue/failure label.
replaceOnce(
  "server/mobile.ts",
  '  if (message.mime !== undefined) safe.mime = message.mime;\n',
  '  if (message.mime !== undefined) safe.mime = message.mime;\n  if (message.delivery === "queued" || message.delivery === "failed") safe.delivery = message.delivery;\n',
  "mobile delivery projection",
);

// Visible transcript export preserves the state without exposing any provider internals.
replaceOnce(
  "server/transcript-navigation.ts",
  '  tool?: { name: string; ok?: boolean };\n  screenOmitted?: true;\n}',
  '  tool?: { name: string; ok?: boolean };\n  delivery?: "queued" | "failed";\n  screenOmitted?: true;\n}',
  "export delivery type",
);
replaceOnce(
  "server/transcript-navigation.ts",
  '    ...(message.tool ? { tool: { name: message.tool.name, ...(message.tool.ok !== undefined ? { ok: message.tool.ok } : {}) } } : {}),\n    ...(message.kind === "screen" ? { screenOmitted: true } : {}),',
  '    ...(message.tool ? { tool: { name: message.tool.name, ...(message.tool.ok !== undefined ? { ok: message.tool.ok } : {}) } } : {}),\n    ...(message.delivery === "queued" || message.delivery === "failed" ? { delivery: message.delivery } : {}),\n    ...(message.kind === "screen" ? { screenOmitted: true } : {}),',
  "export delivery projection",
);
replaceOnce(
  "server/transcript-navigation.ts",
  '    if (message.text) lines.push(markdownText(message.text), "");\n',
  '    if (message.text) lines.push(markdownText(message.text), "");\n    if (message.delivery === "queued") lines.push("_Queued for the next attended turn._", "");\n    if (message.delivery === "failed") lines.push("_This steering message was not delivered._", "");\n',
  "markdown delivery state",
);

// One follow-up can consume several canonical user rows. Failed/queued rows
// never leak into a later unrelated provider transcript.
replaceOnce(
  "server/turn-context.ts",
  'export function boundedTurnTranscript(\n  messages: readonly Message[],\n  currentMessageId?: string,\n): Array<{ role: "user" | "assistant"; text: string }> {\n  const candidates = messages\n    .filter(\n      (message) =>\n        message.id !== currentMessageId &&\n        message.kind === "text" &&',
  'export function boundedTurnTranscript(\n  messages: readonly Message[],\n  excludedMessageIds?: string | readonly string[],\n): Array<{ role: "user" | "assistant"; text: string }> {\n  const excluded = new Set(\n    typeof excludedMessageIds === "string"\n      ? [excludedMessageIds]\n      : excludedMessageIds ?? [],\n  );\n  const candidates = messages\n    .filter(\n      (message) =>\n        !excluded.has(message.id) &&\n        message.delivery !== "queued" &&\n        message.delivery !== "failed" &&\n        message.kind === "text" &&',
  "multi-message transcript exclusion",
);

// Harness orchestration.
replaceOnce(
  "server/index.ts",
  'import { buildDesktopBootstrap } from "./bootstrap.ts";\n',
  'import { buildDesktopBootstrap } from "./bootstrap.ts";\nimport { assertBusySteeringCapacity, coalesceBusySteering, queuedSteering } from "./busy-steering.ts";\n',
  "busy steering import",
);
replaceOnce(
  "server/index.ts",
  'interface TurnOptions {\n  commsDepth?: number;\n  source?: TaskSource;\n  sourceBotId?: string;\n  routineId?: string;\n  taskId?: string;\n  taskTitle?: string;\n  attachments?: AttachmentRecord[];\n  track?: boolean;\n}',
  'interface TurnOptions {\n  commsDepth?: number;\n  source?: TaskSource;\n  sourceBotId?: string;\n  routineId?: string;\n  taskId?: string;\n  taskTitle?: string;\n  attachments?: AttachmentRecord[];\n  track?: boolean;\n  /** Existing queued user rows consumed by this single attended follow-up. */\n  existingUserMessageIds?: string[];\n  onDispatchAccepted?: () => void;\n  onDispatchFailed?: (error: unknown) => void;\n}',
  "TurnOptions steering hooks",
);

const steeringHelpers = [
  'const steeringDrainInFlight = new Set<string>();',
  '',
  'function patchSteeringDelivery(threadId: string, messageIds: readonly string[], delivery?: "queued" | "failed") {',
  '  for (const messageId of messageIds) {',
  '    const message = store.patchMessage(threadId, messageId, { delivery });',
  '    if (message) broadcast({ kind: "message.patch", threadId, message });',
  '  }',
  '}',
  '',
  'function markSteeringFailed(',
  '  bot: NonNullable<ReturnType<typeof store.bot>>,',
  '  messageIds: readonly string[],',
  '  error: unknown,',
  '  appendActivity: boolean,',
  ') {',
  '  patchSteeringDelivery(bot.threadId, messageIds, "failed");',
  '  if (!appendActivity) return;',
  '  const detail = error instanceof Error ? error.message : String(error);',
  '  const activity = store.appendMessage(bot.threadId, {',
  '    role: "bot",',
  '    kind: "activity",',
  '    tool: { name: "queued steering failed: " + detail.slice(0, 140), ok: false },',
  '  });',
  '  broadcast({ kind: "message", threadId: bot.threadId, message: activity });',
  '}',
  '',
  'function queueBusySteering(',
  '  bot: NonNullable<ReturnType<typeof store.bot>>,',
  '  text: string,',
  '  attachments: AttachmentRecord[],',
  ') {',
  '  const current = queuedSteering(store.messagesFor(bot.threadId));',
  '  assertBusySteeringCapacity({ current, text, attachments });',
  '  const message = store.appendMessage(bot.threadId, {',
  '    role: "user",',
  '    kind: "text",',
  '    text,',
  '    delivery: "queued",',
  '    ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),',
  '  });',
  '  broadcast({ kind: "message", threadId: bot.threadId, message });',
  '  return message;',
  '}',
  '',
  'function scheduleSteeringDrain(botId: string) {',
  '  queueMicrotask(() => void drainBusySteering(botId));',
  '}',
  '',
  'async function drainBusySteering(botId: string) {',
  '  if (steeringDrainInFlight.has(botId)) return;',
  '  const bot = store.bot(botId);',
  '  if (!bot || bot.busy) return;',
  '  const group = coalesceBusySteering(queuedSteering(store.messagesFor(bot.threadId)));',
  '  if (!group) return;',
  '',
  '  steeringDrainInFlight.add(botId);',
  '  try {',
  '    const attachments = workspace.attachmentsFor(bot.id, group.attachmentIds);',
  '    await startTurn(bot.id, group.text, {',
  '      attachments,',
  '      existingUserMessageIds: group.messageIds,',
  '      track: true,',
  '      onDispatchAccepted: () => patchSteeringDelivery(bot.threadId, group.messageIds),',
  '      onDispatchFailed: (error) => markSteeringFailed(bot, group.messageIds, error, false),',
  '    });',
  '  } catch (error) {',
  '    markSteeringFailed(bot, group.messageIds, error, true);',
  '  } finally {',
  '    steeringDrainInFlight.delete(botId);',
  '  }',
  '}',
  '',
].join("\n");
replaceOnce(
  "server/index.ts",
  'async function startTurn(botId: string, text: string, opts: TurnOptions = {}) {',
  steeringHelpers + 'async function startTurn(botId: string, text: string, opts: TurnOptions = {}) {',
  "steering helpers",
);
replaceOnce(
  "server/index.ts",
  '  const commsDepth = opts.commsDepth ?? 0;\n  const attachments = opts.attachments ?? [];\n  const selection = { ...bot.modelSelection };\n',
  '  const commsDepth = opts.commsDepth ?? 0;\n  const attachments = opts.attachments ?? [];\n  const selection = { ...bot.modelSelection };\n  const existingUserMessageIds = [...new Set(opts.existingUserMessageIds ?? [])];\n  if (existingUserMessageIds.length) {\n    const byId = new Map(store.messagesFor(bot.threadId).map((message) => [message.id, message]));\n    for (const messageId of existingUserMessageIds) {\n      const message = byId.get(messageId);\n      if (!message || message.role !== "user" || message.kind !== "text" || message.delivery !== "queued") {\n        throw Object.assign(new Error("queued steering state changed before dispatch"), { status: 409 });\n      }\n    }\n  }\n',
  "queued steering validation",
);
replaceOnce(
  "server/index.ts",
  '  const userMessage = store.appendMessage(bot.threadId, {\n    role: "user",\n    kind: "text",\n    text,\n    ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),\n  });\n  broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });',
  '  const userMessage = existingUserMessageIds.length\n    ? null\n    : store.appendMessage(bot.threadId, {\n        role: "user",\n        kind: "text",\n        text,\n        ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),\n      });\n  if (userMessage) broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });',
  "reuse queued user rows",
);
replaceOnce(
  "server/index.ts",
  '  const transcript = boundedTurnTranscript(store.messagesFor(bot.threadId), userMessage.id);',
  '  const transcript = boundedTurnTranscript(\n    store.messagesFor(bot.threadId),\n    existingUserMessageIds.length ? existingUserMessageIds : userMessage?.id,\n  );',
  "exclude current steering rows",
);
replaceOnce(
  "server/index.ts",
  '      if (runId) {\n        workspace.bindTurn(runId, started.turnId);',
  '      try { opts.onDispatchAccepted?.(); } catch (callbackError) { console.error("steering dispatch callback failed", callbackError); }\n      if (runId) {\n        workspace.bindTurn(runId, started.turnId);',
  "dispatch accepted callback",
);
replaceOnce(
  "server/index.ts",
  '    } catch (e) {\n      const message = e instanceof Error ? e.message : String(e);',
  '    } catch (e) {\n      try { opts.onDispatchFailed?.(e); } catch (callbackError) { console.error("steering failure callback failed", callbackError); }\n      const message = e instanceof Error ? e.message : String(e);',
  "dispatch failed callback",
);
replaceOnce(
  "server/index.ts",
  '      store.patchBot(bot.id, { busy: false });\n      broadcast({ kind: "bot", bot: store.bot(bot.id) });\n    }\n  })();\n}',
  '      store.patchBot(bot.id, { busy: false });\n      broadcast({ kind: "bot", bot: store.bot(bot.id) });\n      scheduleSteeringDrain(bot.id);\n    }\n  })();\n  return userMessage;\n}',
  "background failure drain",
);
replaceOnce(
  "server/index.ts",
  '      store.patchBot(bot.id, { busy: false, unread: true });\n      broadcast({ kind: "bot", bot: store.bot(bot.id) });\n      clearThreadEventState(event.threadId);\n      break;',
  '      store.patchBot(bot.id, { busy: false, unread: true });\n      broadcast({ kind: "bot", bot: store.bot(bot.id) });\n      clearThreadEventState(event.threadId);\n      scheduleSteeringDrain(bot.id);\n      break;',
  "turn completion drain",
);
replaceOnce(
  "server/index.ts",
  '  for (const bot of store.bots) {\n    if (!bot.busy) continue;\n    store.patchBot(bot.id, { busy: false });\n    const runId = activeRunByThread.get(bot.threadId);\n    if (runId) {\n      workspace.completeRun(runId, false, "Providers reloaded while the task was running.");\n      activeRunByThread.delete(bot.threadId);\n    }\n    clearThreadEventState(bot.threadId);\n    broadcast({ kind: "bot", bot: store.bot(bot.id) });\n  }\n  broadcastWorkspace();',
  '  for (const bot of store.bots) {\n    if (bot.busy) {\n      store.patchBot(bot.id, { busy: false });\n      const runId = activeRunByThread.get(bot.threadId);\n      if (runId) {\n        workspace.completeRun(runId, false, "Providers reloaded while the task was running.");\n        activeRunByThread.delete(bot.threadId);\n      }\n      clearThreadEventState(bot.threadId);\n      broadcast({ kind: "bot", bot: store.bot(bot.id) });\n    }\n    scheduleSteeringDrain(bot.id);\n  }\n  broadcastWorkspace();',
  "provider reload drain",
);
replaceOnce(
  "server/index.ts",
  '    if (m && method === "POST") {\n      const body = await readBody(req);\n      const text = String(body.text ?? "").trim();\n      if (!text) return json(res, 400, { error: "text required" });\n      const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String).slice(0, 10) : [];\n      const attachments = workspace.attachmentsFor(m[1], attachmentIds);\n      await startTurn(m[1], text, { attachments, track: body.track !== false });\n      return json(res, 202, { ok: true });\n    }',
  '    if (m && method === "POST") {\n      const bot = store.bot(m[1]);\n      if (!bot || (surface === "remote" && bot.hidden)) return json(res, 404, { error: "no such bot" });\n      const body = await readBody(req);\n      const text = String(body.text ?? "").trim();\n      if (!text) return json(res, 400, { error: "text required" });\n      const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String).slice(0, 10) : [];\n      const attachments = workspace.attachmentsFor(m[1], attachmentIds);\n      const alreadyQueued = queuedSteering(store.messagesFor(bot.threadId)).length > 0;\n      if (bot.busy || alreadyQueued) {\n        const message = queueBusySteering(bot, text, attachments);\n        if (!bot.busy) scheduleSteeringDrain(bot.id);\n        const responseMessage = surface === "remote" ? publicMobileMessage(message, visibleRemoteBotIds()) : message;\n        return json(res, 202, { ok: true, queued: true, message: responseMessage });\n      }\n      const message = await startTurn(m[1], text, { attachments, track: body.track !== false });\n      const responseMessage = message && surface === "remote" ? publicMobileMessage(message, visibleRemoteBotIds()) : message;\n      return json(res, 202, { ok: true, queued: false, ...(responseMessage ? { message: responseMessage } : {}) });\n    }',
  "attended queue route",
);
replaceOnce(
  "server/index.ts",
  'const initialRoutineTimer = setTimeout(() => void dispatchDueRoutines(), 1_000);\ninitialRoutineTimer.unref();',
  'const initialRoutineTimer = setTimeout(() => void dispatchDueRoutines(), 1_000);\ninitialRoutineTimer.unref();\n\nconst steeringRecoveryTimer = setTimeout(() => {\n  for (const bot of store.bots) {\n    if (!queuedSteering(store.messagesFor(bot.threadId)).length) continue;\n    const instance = registry.get(bot.modelSelection.instanceId);\n    if (bot.busy && !instance?.adapter.hasSession(bot.threadId)) {\n      store.patchBot(bot.id, { busy: false });\n      broadcast({ kind: "bot", bot: store.bot(bot.id) });\n    }\n    scheduleSteeringDrain(bot.id);\n  }\n}, 1_200);\nsteeringRecoveryTimer.unref();',
  "restart recovery",
);
replaceOnce(
  "server/index.ts",
  '    clearInterval(routineTimer);\n    clearTimeout(initialRoutineTimer);',
  '    clearInterval(routineTimer);\n    clearTimeout(initialRoutineTimer);\n    clearTimeout(steeringRecoveryTimer);',
  "recovery timer shutdown",
);

// Desktop request/result and queue affordances.
replaceOnce(
  "src/state/store.tsx",
  '      await api(`/api/bots/${input.botId}/messages`, {\n        method: "POST",\n        body: JSON.stringify({\n          text: input.text,\n          attachmentIds: input.attachments?.map((attachment) => attachment.id) ?? [],\n          track: input.track,\n        }),\n      });\n      rawDispatch({ type: "previewMascotMotion", botId: input.botId, kind: "working" });',
  '      const response = await api(`/api/bots/${input.botId}/messages`, {\n        method: "POST",\n        body: JSON.stringify({\n          text: input.text,\n          attachmentIds: input.attachments?.map((attachment) => attachment.id) ?? [],\n          track: input.track,\n        }),\n      });\n      if (!response.queued) rawDispatch({ type: "previewMascotMotion", botId: input.botId, kind: "working" });',
  "desktop queued response",
);
replaceOnce(
  "src/components/Composer.tsx",
  '    if ((!text.trim() && !attachments.length) || bot.busy || uploading || sending) return;',
  '    if ((!text.trim() && !attachments.length) || uploading || sending) return;',
  "desktop send while busy",
);
replaceOnce(
  "src/components/Composer.tsx",
  '          disabled={uploading || sending || attachments.length >= 10 || bot.busy}',
  '          disabled={uploading || sending || attachments.length >= 10}',
  "desktop busy attachment",
);
replaceOnce(
  "src/components/Composer.tsx",
  '            recording ? "Listening…" : bot.busy ? `${bot.name} is working…` : `Message ${bot.name}`\n',
  '            recording ? "Listening…" : bot.busy ? `Steer ${bot.name} after this turn…` : `Message ${bot.name}`\n',
  "desktop steering placeholder",
);
replaceOnce(
  "src/components/Composer.tsx",
  '        ) : hasPayload ? (\n          <button',
  '        ) : null}\n        {hasPayload ? (\n          <button',
  "desktop split stop and send",
);
replaceOnce(
  "src/components/Composer.tsx",
  '            title={sending ? "Sending…" : "Send"}\n            aria-label={sending ? "Sending message" : `Send message to ${bot.name}`}',
  '            title={sending ? "Sending…" : bot.busy ? "Queue steering after the current turn" : "Send"}\n            aria-label={sending ? "Sending message" : bot.busy ? `Queue steering for ${bot.name}` : `Send message to ${bot.name}`}',
  "desktop queued send label",
);
replaceOnce(
  "src/components/Composer.tsx",
  '          </button>\n        ) : (\n          <button\n            type="button"\n            onClick={toggleMic}',
  '          </button>\n        ) : !bot.busy ? (\n          <button\n            type="button"\n            onClick={toggleMic}',
  "desktop hide mic while busy",
);
replaceOnce(
  "src/components/Composer.tsx",
  '            <Mic size={18} />\n          </button>\n        )}\n',
  '            <Mic size={18} />\n          </button>\n        ) : null}\n',
  "desktop close split control",
);
replaceOnce(
  "src/components/ChatView.tsx",
  '        ) : null}\n      </div>\n    </div>\n  );\n}\n\nfunction HandoffCard',
  '        ) : null}\n        {user && message.delivery === "queued" ? (\n          <div className="mt-1.5 text-right text-[10px] text-ink-secondary">Queued · sends after the current turn</div>\n        ) : null}\n        {user && message.delivery === "failed" ? (\n          <div className="mt-1.5 text-right text-[10px] text-danger">Not sent</div>\n        ) : null}\n      </div>\n    </div>\n  );\n}\n\nfunction HandoffCard',
  "desktop bubble delivery state",
);

// Paired mobile projection/client/state.
replaceOnce(
  "apps/mobile/src/host/host-client.ts",
  '  tool?: { name?: string; ok?: boolean };\n  at: number;\n}',
  '  tool?: { name?: string; ok?: boolean };\n  delivery?: "queued" | "failed";\n  at: number;\n}',
  "mobile RawMessage delivery",
);
replaceOnce(
  "apps/mobile/src/host/host-client.ts",
  '    status: message.tool?.ok === false ? "error" : "done",',
  '    status: message.delivery === "queued" ? "queued" : message.delivery === "failed" || message.tool?.ok === false ? "error" : "done",',
  "mobile map delivery",
);
replaceOnce(
  "apps/mobile/src/host/host-client.ts",
  '  async sendMessage(agentId: string, text: string, attachmentIds: string[] = []): Promise<void> {\n    await this.request(`/api/bots/${encodeURIComponent(agentId)}/messages`, {\n      method: "POST",\n      body: JSON.stringify({ text, attachmentIds }),\n    });\n  }',
  '  async sendMessage(agentId: string, text: string, attachmentIds: string[] = []): Promise<{ queued: boolean; message: ChatMessage | null }> {\n    const body = await this.request(`/api/bots/${encodeURIComponent(agentId)}/messages`, {\n      method: "POST",\n      body: JSON.stringify({ text, attachmentIds }),\n    });\n    const raw = rawMessage(body.message);\n    return { queued: body.queued === true, message: raw ? mapMessage(agentId, raw) : null };\n  }',
  "mobile send response",
);
replaceOnce(
  "apps/mobile/src/host/types.ts",
  '  status?: "sending" | "streaming" | "done" | "error";',
  '  status?: "sending" | "queued" | "streaming" | "done" | "error";',
  "mobile queued status type",
);
replaceOnce(
  "apps/mobile/src/state/cumea-store.tsx",
  '      await client.sendMessage(agentId, text, uploaded.map((attachment) => attachment.id));\n      setState((current) => ({\n        ...current,\n        messages: {\n          ...current.messages,\n          [agentId]: (current.messages[agentId] ?? []).map((message) =>\n            message.id === clientMessageId ? { ...message, status: "done" } : message,\n          ),\n        },\n      }));',
  '      const sent = await client.sendMessage(agentId, text, uploaded.map((attachment) => attachment.id));\n      setState((current) => {\n        const withoutOptimistic = (current.messages[agentId] ?? []).filter((message) => message.id !== clientMessageId);\n        const fallback = {\n          ...optimistic,\n          attachments: uploaded.length ? uploaded : optimistic.attachments,\n          status: sent.queued ? ("queued" as const) : ("done" as const),\n        };\n        return {\n          ...current,\n          messages: {\n            ...current.messages,\n            [agentId]: sent.message ? mergeMessages(withoutOptimistic, [sent.message]) : [...withoutOptimistic, fallback],\n          },\n          agents: current.agents.map((agent) =>\n            agent.id === agentId\n              ? { ...agent, presence: sent.queued ? agent.presence : ("working" as const), updatedAt: Date.now() }\n              : agent,\n          ),\n        };\n      });',
  "mobile optimistic reconciliation",
);
replaceOnce(
  "apps/mobile/src/components/message-bubble.tsx",
  '      {message.status === "error" ? <Text style={{ color: theme.danger, fontSize: 11, paddingTop: 4 }}>Not delivered</Text> : null}',
  '      {message.status === "queued" ? <Text style={{ color: theme.textSecondary, fontSize: 11, paddingTop: 4 }}>Queued · sends after the current turn</Text> : null}\n      {message.status === "error" ? <Text style={{ color: theme.danger, fontSize: 11, paddingTop: 4 }}>Not delivered</Text> : null}',
  "mobile bubble queued status",
);
replaceOnce(
  "apps/mobile/src/components/chat-composer.tsx",
  '            placeholder={`Ask ${agentName}`}',
  '            placeholder={working ? `Steer ${agentName} after this turn` : `Ask ${agentName}`}',
  "mobile steering placeholder",
);

const mobileOldButton = [
  '          <PressableScale',
  '            accessibilityRole="button"',
  '            accessibilityLabel={working ? "Stop agent" : showMicrophone ? "Voice input unavailable" : canSend ? "Send message" : "Add a message before sending attachments"}',
  '            accessibilityHint={showMicrophone ? "Voice input is not enabled in this build" : undefined}',
  '            disabled={sending}',
  '            onPress={() => {',
  '              if (working) void stop();',
  '              else if (showMicrophone) Alert.alert("Voice input isn’t enabled yet", "Use the keyboard to message this bot.");',
  '              else void send();',
  '            }}',
  '            style={{ width: 36, height: 36, borderRadius: 18, opacity: working || canSend || showMicrophone ? 1 : 0.4, alignItems: "center", justifyContent: "center", backgroundColor: theme.text }}',
  '          >',
  '            {working ? (',
  '              <Text style={{ color: theme.background, fontSize: 16, fontWeight: "800" }}>■</Text>',
  '            ) : showMicrophone ? (',
  '              <MicrophoneGlyph />',
  '            ) : (',
  '              <Text style={{ color: theme.background, fontSize: 20, fontWeight: "800" }}>↑</Text>',
  '            )}',
  '          </PressableScale>',
].join("\n");
const mobileNewButtons = [
  '          {working ? (',
  '            <PressableScale',
  '              accessibilityRole="button"',
  '              accessibilityLabel="Stop agent"',
  '              disabled={sending}',
  '              onPress={() => void stop()}',
  '              style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.cardRaised }}',
  '            >',
  '              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "800" }}>■</Text>',
  '            </PressableScale>',
  '          ) : null}',
  '          {canSend ? (',
  '            <PressableScale',
  '              accessibilityRole="button"',
  '              accessibilityLabel={working ? `Queue steering for ${agentName}` : "Send message"}',
  '              disabled={sending}',
  '              onPress={() => void send()}',
  '              style={{ width: 36, height: 36, borderRadius: 18, opacity: sending ? 0.55 : 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.text }}',
  '            >',
  '              <Text style={{ color: theme.background, fontSize: 20, fontWeight: "800" }}>↑</Text>',
  '            </PressableScale>',
  '          ) : !working && showMicrophone ? (',
  '            <PressableScale',
  '              accessibilityRole="button"',
  '              accessibilityLabel="Voice input unavailable"',
  '              accessibilityHint="Voice input is not enabled in this build"',
  '              disabled={sending}',
  '              onPress={() => Alert.alert("Voice input isn’t enabled yet", "Use the keyboard to message this bot.")}',
  '              style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.text }}',
  '            >',
  '              <MicrophoneGlyph />',
  '            </PressableScale>',
  '          ) : null}',
].join("\n");
replaceOnce("apps/mobile/src/components/chat-composer.tsx", mobileOldButton, mobileNewButtons, "mobile split stop/send");

assertContains("server/index.ts", [
  "queueBusySteering",
  "drainBusySteering",
  "existingUserMessageIds",
  "steeringRecoveryTimer",
  "queued: true",
]);
assertContains("server/turn-context.ts", ['message.delivery !== "queued"', 'message.delivery !== "failed"']);
assertContains("src/components/ChatView.tsx", ["Queued · sends after the current turn", "Not sent"]);
assertContains("apps/mobile/src/components/message-bubble.tsx", ["Queued · sends after the current turn"]);
