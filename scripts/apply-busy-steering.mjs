import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

// ── canonical/public message shapes ────────────────────────────────────
replaceOnce(
  "server/store.ts",
  '  mime?: "image/png" | "image/jpeg";\n  at: number;\n}',
  '  mime?: "image/png" | "image/jpeg";\n  /** Explicit attended user steering persisted while a bot is already busy. */\n  delivery?: "queued" | "failed";\n  at: number;\n}',
  "server Message delivery",
);
replaceOnce(
  "src/state/store.tsx",
  '  mime?: string;\n  at: number;\n}',
  '  mime?: string;\n  delivery?: "queued" | "failed";\n  at: number;\n}',
  "renderer Message delivery",
);
replaceOnce(
  "server/mobile.ts",
  '    ...(message.attachments?.length ? { attachments: message.attachments.map(publicMobileAttachment) } : {}),\n',
  '    ...(message.attachments?.length ? { attachments: message.attachments.map(publicMobileAttachment) } : {}),\n    ...(message.delivery === "queued" || message.delivery === "failed" ? { delivery: message.delivery } : {}),\n',
  "mobile delivery projection",
);
replaceOnce(
  "server/transcript-navigation.ts",
  '  screenOmitted?: true;\n}',
  '  delivery?: "queued" | "failed";\n  screenOmitted?: true;\n}',
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
replaceOnce(
  "server/transcript-store.ts",
  '  if (message.at !== undefined && (typeof message.at !== "number" || !Number.isFinite(message.at))) {\n    throw new Error("invalid transcript message timestamp");\n  }\n',
  '  if (message.at !== undefined && (typeof message.at !== "number" || !Number.isFinite(message.at))) {\n    throw new Error("invalid transcript message timestamp");\n  }\n  if (message.delivery !== undefined && message.delivery !== "queued" && message.delivery !== "failed") {\n    throw new Error("invalid transcript message delivery state");\n  }\n',
  "transcript delivery validation",
);

// ── bounded transcript can exclude one or many current attended messages ─
replaceOnce(
  "server/turn-context.ts",
  'export function boundedTurnTranscript(\n  messages: readonly Message[],\n  currentMessageId?: string,\n): Array<{ role: "user" | "assistant"; text: string }> {\n  const candidates = messages\n    .filter(\n      (message) =>\n        message.id !== currentMessageId &&',
  'export function boundedTurnTranscript(\n  messages: readonly Message[],\n  excludedMessageIds?: string | readonly string[],\n): Array<{ role: "user" | "assistant"; text: string }> {\n  const excluded = new Set(\n    typeof excludedMessageIds === "string"\n      ? [excludedMessageIds]\n      : excludedMessageIds ?? [],\n  );\n  const candidates = messages\n    .filter(\n      (message) =>\n        !excluded.has(message.id) &&',
  "multi-message transcript exclusion",
);

// ── server orchestration ───────────────────────────────────────────────
replaceOnce(
  "server/index.ts",
  'import { buildDesktopBootstrap } from "./bootstrap.ts";\n',
  'import { buildDesktopBootstrap } from "./bootstrap.ts";\nimport { assertBusySteeringCapacity, coalesceBusySteering, queuedSteering } from "./busy-steering.ts";\n',
  "busy steering import",
);
replaceOnce(
  "server/index.ts",
  'interface TurnOptions {\n  commsDepth?: number;\n  source?: TaskSource;\n  sourceBotId?: string;\n  routineId?: string;\n  taskId?: string;\n  taskTitle?: string;\n  attachments?: AttachmentRecord[];\n  track?: boolean;\n}',
  'interface TurnOptions {\n  commsDepth?: number;\n  source?: TaskSource;\n  sourceBotId?: string;\n  routineId?: string;\n  taskId?: string;\n  taskTitle?: string;\n  attachments?: AttachmentRecord[];\n  track?: boolean;\n  /** Existing queued user transcript rows that become this attended turn. */\n  existingUserMessageIds?: string[];\n  onDispatchAccepted?: () => void;\n  onDispatchFailed?: (error: unknown) => void;\n}',
  "TurnOptions steering hooks",
);

const steeringHelpers = `
const steeringDrainInFlight = new Set<string>();

function patchSteeringDelivery(threadId: string, messageIds: readonly string[], delivery?: "queued" | "failed") {
  for (const messageId of messageIds) {
    const message = store.patchMessage(threadId, messageId, { delivery });
    if (message) broadcast({ kind: "message.patch", threadId, message });
  }
}

function steeringFailure(bot: NonNullable<ReturnType<typeof store.bot>>, messageIds: readonly string[], error: unknown) {
  patchSteeringDelivery(bot.threadId, messageIds, "failed");
  const detail = error instanceof Error ? error.message : String(error);
  const activity = store.appendMessage(bot.threadId, {
    role: "bot",
    kind: "activity",
    tool: { name: `queued steering failed: ${detail.slice(0, 140)}`, ok: false },
  });
  broadcast({ kind: "message", threadId: bot.threadId, message: activity });
}

function queueBusySteering(bot: NonNullable<ReturnType<typeof store.bot>>, text: string, attachments: AttachmentRecord[]) {
  const current = queuedSteering(store.messagesFor(bot.threadId));
  assertBusySteeringCapacity({ current, text, attachments });
  const message = store.appendMessage(bot.threadId, {
    role: "user",
    kind: "text",
    text,
    delivery: "queued",
    ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),
  });
  broadcast({ kind: "message", threadId: bot.threadId, message });
  return message;
}

function scheduleSteeringDrain(botId: string) {
  queueMicrotask(() => void drainBusySteering(botId));
}

async function drainBusySteering(botId: string) {
  if (steeringDrainInFlight.has(botId)) return;
  const bot = store.bot(botId);
  if (!bot || bot.busy) return;
  const group = coalesceBusySteering(queuedSteering(store.messagesFor(bot.threadId)));
  if (!group) return;

  steeringDrainInFlight.add(botId);
  try {
    const attachments = workspace.attachmentsFor(bot.id, group.attachmentIds);
    const resolvedIds = new Set(attachments.map((attachment) => attachment.id));
    if (group.attachmentIds.some((id) => !resolvedIds.has(id))) {
      steeringFailure(bot, group.messageIds, new Error("a queued attachment is no longer available"));
      return;
    }

    await startTurn(bot.id, group.text, {
      attachments,
      existingUserMessageIds: group.messageIds,
      track: true,
      onDispatchAccepted: () => patchSteeringDelivery(bot.threadId, group.messageIds),
      onDispatchFailed: (error) => steeringFailure(bot, group.messageIds, error),
    });
  } catch (error) {
    steeringFailure(bot, group.messageIds, error);
  } finally {
    steeringDrainInFlight.delete(botId);
  }
}

`;
replaceOnce(
  "server/index.ts",
  'async function startTurn(botId: string, text: string, opts: TurnOptions = {}) {',
  steeringHelpers + 'async function startTurn(botId: string, text: string, opts: TurnOptions = {}) {',
  "steering helper insertion",
);

replaceOnce(
  "server/index.ts",
  '  const commsDepth = opts.commsDepth ?? 0;\n  const attachments = opts.attachments ?? [];\n  const selection = { ...bot.modelSelection };',
  '  const commsDepth = opts.commsDepth ?? 0;\n  const attachments = opts.attachments ?? [];\n  const selection = { ...bot.modelSelection };\n  const existingUserMessageIds = [...new Set(opts.existingUserMessageIds ?? [])];\n  if (existingUserMessageIds.length) {\n    const byId = new Map(store.messagesFor(bot.threadId).map((message) => [message.id, message]));\n    for (const messageId of existingUserMessageIds) {\n      const message = byId.get(messageId);\n      if (!message || message.role !== "user" || message.kind !== "text" || message.delivery !== "queued") {\n        throw Object.assign(new Error("queued steering state changed before dispatch"), { status: 409 });\n      }\n    }\n  }',
  "existing queued validation",
);

replaceOnce(
  "server/index.ts",
  '  const userMessage = store.appendMessage(bot.threadId, {\n    role: "user",\n    kind: "text",\n    text,\n    ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),\n  });\n  broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });',
  '  const userMessage = existingUserMessageIds.length\n    ? null\n    : store.appendMessage(bot.threadId, {\n        role: "user",\n        kind: "text",\n        text,\n        ...(attachments.length ? { attachments: attachments.map(publicAttachment) } : {}),\n      });\n  if (userMessage) broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });',
  "reuse queued user messages",
);
replaceOnce(
  "server/index.ts",
  '  const transcript = boundedTurnTranscript(store.messagesFor(bot.threadId), userMessage.id);',
  '  const transcript = boundedTurnTranscript(\n    store.messagesFor(bot.threadId),\n    existingUserMessageIds.length ? existingUserMessageIds : userMessage?.id,\n  );',
  "exclude steering current rows",
);
replaceOnce(
  "server/index.ts",
  '      const started = await instance.adapter.sendTurn({',
  '      const started = await instance.adapter.sendTurn({',
  "send turn anchor noop",
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
  "dispatch failure drain and user message return",
);

replaceOnce(
  "server/index.ts",
  '      clearThreadEventState(event.threadId);\n      break;\n    }',
  '      clearThreadEventState(event.threadId);\n      scheduleSteeringDrain(bot.id);\n      break;\n    }',
  "turn completion drain",
);
replaceOnce(
  "server/index.ts",
  '    broadcast({ kind: "bot", bot: store.bot(bot.id) });\n  }\n  broadcastWorkspace();\n}',
  '    broadcast({ kind: "bot", bot: store.bot(bot.id) });\n    scheduleSteeringDrain(bot.id);\n  }\n  broadcastWorkspace();\n}',
  "provider reload drain",
);

replaceOnce(
  "server/index.ts",
  '    if (m && method === "POST") {\n      const body = await readBody(req);\n      const text = String(body.text ?? "").trim();\n      if (!text) return json(res, 400, { error: "text required" });\n      const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String).slice(0, 10) : [];\n      const attachments = workspace.attachmentsFor(m[1], attachmentIds);\n      await startTurn(m[1], text, { attachments, track: body.track !== false });\n      return json(res, 202, { ok: true });\n    }',
  '    if (m && method === "POST") {\n      const bot = store.bot(m[1]);\n      if (!bot || (surface === "remote" && bot.hidden)) return json(res, 404, { error: "no such bot" });\n      const body = await readBody(req);\n      const text = String(body.text ?? "").trim();\n      if (!text) return json(res, 400, { error: "text required" });\n      const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String).slice(0, 10) : [];\n      const attachments = workspace.attachmentsFor(m[1], attachmentIds);\n      if (bot.busy) {\n        const message = queueBusySteering(bot, text, attachments);\n        return json(res, 202, { ok: true, queued: true, message });\n      }\n      const message = await startTurn(m[1], text, { attachments, track: body.track !== false });\n      return json(res, 202, { ok: true, queued: false, ...(message ? { message } : {}) });\n    }',
  "attended busy queue route",
);

// Startup recovery: a new process owns no old in-flight provider session.
replaceOnce(
  "server/index.ts",
  'const initialRoutineTimer = setTimeout(() => void dispatchDueRoutines(), 1_000);\ninitialRoutineTimer.unref();',
  'const initialRoutineTimer = setTimeout(() => void dispatchDueRoutines(), 1_000);\ninitialRoutineTimer.unref();\n\nconst steeringRecoveryTimer = setTimeout(() => {\n  for (const bot of store.bots) {\n    if (!queuedSteering(store.messagesFor(bot.threadId)).length) continue;\n    const instance = registry.get(bot.modelSelection.instanceId);\n    if (bot.busy && !instance?.adapter.hasSession(bot.threadId)) {\n      store.patchBot(bot.id, { busy: false });\n      broadcast({ kind: "bot", bot: store.bot(bot.id) });\n    }\n    scheduleSteeringDrain(bot.id);\n  }\n}, 1_200);\nsteeringRecoveryTimer.unref();',
  "startup steering recovery",
);

// ── desktop UI ─────────────────────────────────────────────────────────
replaceOnce(
  "src/state/store.tsx",
  '      await api(`/api/bots/${input.botId}/messages`, {\n        method: "POST",\n        body: JSON.stringify({\n          text: input.text,\n          attachmentIds: input.attachments?.map((attachment) => attachment.id) ?? [],\n          track: input.track,\n        }),\n      });\n      rawDispatch({ type: "previewMascotMotion", botId: input.botId, kind: "working" });',
  '      const response = await api(`/api/bots/${input.botId}/messages`, {\n        method: "POST",\n        body: JSON.stringify({\n          text: input.text,\n          attachmentIds: input.attachments?.map((attachment) => attachment.id) ?? [],\n          track: input.track,\n        }),\n      });\n      if (!response.queued) rawDispatch({ type: "previewMascotMotion", botId: input.botId, kind: "working" });',
  "desktop queued send response",
);
replaceOnce(
  "src/components/Composer.tsx",
  '    if ((!text.trim() && !attachments.length) || bot.busy || uploading || sending) return;',
  '    if ((!text.trim() && !attachments.length) || uploading || sending) return;',
  "desktop busy send gate",
);
replaceOnce(
  "src/components/Composer.tsx",
  '          disabled={uploading || sending || attachments.length >= 10 || bot.busy}',
  '          disabled={uploading || sending || attachments.length >= 10}',
  "desktop busy attachment gate",
);
replaceOnce(
  "src/components/Composer.tsx",
  '            recording ? "Listening…" : bot.busy ? `${bot.name} is working…` : `Message ${bot.name}`\n',
  '            recording ? "Listening…" : bot.busy ? `Steer ${bot.name} after this turn…` : `Message ${bot.name}`\n',
  "desktop busy placeholder",
);
replaceOnce(
  "src/components/Composer.tsx",
  `        {bot.busy ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
            title="Stop"
            aria-label={\`Stop \${bot.name}\`}
          >
            <Square size={14} className="fill-current" />
          </button>
        ) : hasPayload ? (
          <button
            type="button"
            onClick={() => void send()}
            disabled={uploading || sending}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-app transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
            title={sending ? "Sending…" : "Send"}
            aria-label={sending ? "Sending message" : \`Send message to \${bot.name}\`}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.4} />}
          </button>
        ) : (
`,
  `        {bot.busy ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
            title="Stop current turn"
            aria-label={\`Stop \${bot.name}\`}
          >
            <Square size={14} className="fill-current" />
          </button>
        ) : null}
        {hasPayload ? (
          <button
            type="button"
            onClick={() => void send()}
            disabled={uploading || sending}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-app transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
            title={sending ? "Sending…" : bot.busy ? "Queue steering after the current turn" : "Send"}
            aria-label={sending ? "Sending message" : bot.busy ? \`Queue steering for \${bot.name}\` : \`Send message to \${bot.name}\`}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.4} />}
          </button>
        ) : !bot.busy ? (
`,
  "desktop dual stop/send controls",
);
replaceOnce(
  "src/components/ChatView.tsx",
  '        {message.attachments?.length ? (',
  '        {message.attachments?.length ? (',
  "chat attachment anchor noop",
);
replaceOnce(
  "src/components/ChatView.tsx",
  '        ) : null}\n      </div>\n    </div>\n  );\n}',
  '        ) : null}\n        {user && message.delivery === "queued" ? (\n          <div className="mt-1.5 text-right text-[10px] text-ink-secondary">Queued · sends after the current turn</div>\n        ) : null}\n        {user && message.delivery === "failed" ? (\n          <div className="mt-1.5 text-right text-[10px] text-danger">Not sent</div>\n        ) : null}\n      </div>\n    </div>\n  );\n}',
  "desktop queued bubble status",
);

// ── paired mobile projection / UX ─────────────────────────────────────
replaceOnce(
  "apps/mobile/src/host/host-client.ts",
  '  attachments?: ChatAttachment[];\n};',
  '  attachments?: ChatAttachment[];\n  delivery?: "queued" | "failed";\n};',
  "mobile RawMessage delivery",
);
replaceOnce(
  "apps/mobile/src/host/host-client.ts",
  '    attachments: Array.isArray(value.attachments) ? value.attachments.map(rawAttachment).filter((item): item is ChatAttachment => item !== null) : undefined,\n  };',
  '    attachments: Array.isArray(value.attachments) ? value.attachments.map(rawAttachment).filter((item): item is ChatAttachment => item !== null) : undefined,\n    delivery: value.delivery === "queued" || value.delivery === "failed" ? value.delivery : undefined,\n  };',
  "mobile raw delivery parser",
);
replaceOnce(
  "apps/mobile/src/host/host-client.ts",
  '    status: message.tool?.ok === false ? "error" : "done",',
  '    status: message.delivery === "queued" ? "queued" : message.delivery === "failed" || message.tool?.ok === false ? "error" : "done",',
  "mobile delivery status map",
);
replaceOnce(
  "apps/mobile/src/host/types.ts",
  '  status: "sending" | "streaming" | "done" | "error";',
  '  status: "sending" | "queued" | "streaming" | "done" | "error";',
  "mobile ChatMessage queued status",
);
replaceOnce(
  "apps/mobile/src/host/host-client.ts",
  '  async sendMessage(agentId: string, text: string, attachmentIds: string[] = []): Promise<void> {\n    await this.request(`/api/bots/${encodeURIComponent(agentId)}/messages`, {\n      method: "POST",\n      body: JSON.stringify({ text, attachmentIds }),\n    });\n  }',
  '  async sendMessage(agentId: string, text: string, attachmentIds: string[] = []): Promise<{ queued: boolean; message: ChatMessage | null }> {\n    const body = await this.request(`/api/bots/${encodeURIComponent(agentId)}/messages`, {\n      method: "POST",\n      body: JSON.stringify({ text, attachmentIds }),\n    });\n    const raw = rawMessage(body.message);\n    return {\n      queued: body.queued === true,\n      message: raw ? mapMessage(agentId, raw) : null,\n    };\n  }',
  "mobile send result",
);
replaceOnce(
  "apps/mobile/src/state/cumea-store.tsx",
  '      await client.sendMessage(agentId, text, uploaded.map((attachment) => attachment.id));\n      setState((current) => ({\n        ...current,\n        messages: {\n          ...current.messages,\n          [agentId]: (current.messages[agentId] ?? []).map((message) =>\n            message.id === clientMessageId ? { ...message, status: "done" } : message,\n          ),\n        },\n      }));',
  '      const sent = await client.sendMessage(agentId, text, uploaded.map((attachment) => attachment.id));\n      setState((current) => {\n        const withoutOptimistic = (current.messages[agentId] ?? []).filter((message) => message.id !== clientMessageId);\n        const nextMessages = sent.message\n          ? mergeMessages(withoutOptimistic, [sent.message])\n          : [...withoutOptimistic, { ...optimistic, attachments: uploaded.length ? uploaded : optimistic.attachments, status: sent.queued ? ("queued" as const) : ("done" as const) }];\n        return {\n          ...current,\n          messages: { ...current.messages, [agentId]: nextMessages },\n          agents: current.agents.map((agent) =>\n            agent.id === agentId\n              ? { ...agent, presence: sent.queued ? agent.presence : ("working" as const), updatedAt: Date.now() }\n              : agent,\n          ),\n        };\n      });',
  "mobile optimistic queue reconciliation",
);
replaceOnce(
  "apps/mobile/src/components/message-bubble.tsx",
  '      {message.status === "error" ? <Text style={{ color: theme.danger, fontSize: 11, paddingTop: 4 }}>Not delivered</Text> : null}',
  '      {message.status === "queued" ? <Text style={{ color: theme.textSecondary, fontSize: 11, paddingTop: 4 }}>Queued · sends after the current turn</Text> : null}\n      {message.status === "error" ? <Text style={{ color: theme.danger, fontSize: 11, paddingTop: 4 }}>Not delivered</Text> : null}',
  "mobile queued bubble status",
);
replaceOnce(
  "apps/mobile/src/components/chat-composer.tsx",
  '            placeholder={`Ask ${agentName}`}',
  '            placeholder={working ? `Steer ${agentName} after this turn` : `Ask ${agentName}`}',
  "mobile busy placeholder",
);

const mobileButton = `          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={working ? "Stop agent" : showMicrophone ? "Voice input unavailable" : canSend ? "Send message" : "Add a message before sending attachments"}
            accessibilityHint={showMicrophone ? "Voice input is not enabled in this build" : undefined}
            disabled={sending}
            onPress={() => {
              if (working) void stop();
              else if (showMicrophone) Alert.alert("Voice input isn’t enabled yet", "Use the keyboard to message this bot.");
              else void send();
            }}
            style={{ width: 36, height: 36, borderRadius: 18, opacity: working || canSend || showMicrophone ? 1 : 0.4, alignItems: "center", justifyContent: "center", backgroundColor: theme.text }}
          >
            {working ? (
              <Text style={{ color: theme.background, fontSize: 16, fontWeight: "800" }}>■</Text>
            ) : showMicrophone ? (
              <MicrophoneGlyph />
            ) : (
              <Text style={{ color: theme.background, fontSize: 20, fontWeight: "800" }}>↑</Text>
            )}
          </PressableScale>`;
const mobileButtons = `          {working ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Stop agent"
              disabled={sending}
              onPress={() => void stop()}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.cardRaised }}
            >
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "800" }}>■</Text>
            </PressableScale>
          ) : null}
          {canSend ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={working ? `Queue steering for ${agentName}` : "Send message"}
              disabled={sending}
              onPress={() => void send()}
              style={{ width: 36, height: 36, borderRadius: 18, opacity: sending ? 0.55 : 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.text }}
            >
              <Text style={{ color: theme.background, fontSize: 20, fontWeight: "800" }}>↑</Text>
            </PressableScale>
          ) : !working && showMicrophone ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Voice input unavailable"
              accessibilityHint="Voice input is not enabled in this build"
              disabled={sending}
              onPress={() => Alert.alert("Voice input isn’t enabled yet", "Use the keyboard to message this bot.")}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.text }}
            >
              <MicrophoneGlyph />
            </PressableScale>
          ) : null}`;
replaceOnce("apps/mobile/src/components/chat-composer.tsx", mobileButton, mobileButtons, "mobile dual stop/send controls");

for (const [path, needles] of Object.entries({
  "server/index.ts": ["queueBusySteering", "drainBusySteering", "existingUserMessageIds", "queued: true", "steeringRecoveryTimer"],
  "server/store.ts": ['delivery?: "queued" | "failed"'],
  "src/components/Composer.tsx": ["Queue steering after the current turn", "Steer ${bot.name} after this turn"],
  "src/components/ChatView.tsx": ["Queued · sends after the current turn", "Not sent"],
  "apps/mobile/src/components/chat-composer.tsx": ["Queue steering for ${agentName}", "Steer ${agentName} after this turn"],
  "apps/mobile/src/host/types.ts": ['"queued"'],
})) {
  const source = readFileSync(path, "utf8");
  for (const needle of needles) if (!source.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
