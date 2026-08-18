import { readFileSync, writeFileSync } from "node:fs";

function edit(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: transform made no changes`);
  writeFileSync(path, after);
}
function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

edit("src/state/store.tsx", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `  error: string | null;\n  mascotMotion: {\n`,
    `  error: string | null;\n  /** Historical window opened from the desktop transcript-search surface. */\n  searchFocus: {\n    botId: string;\n    messageId: string;\n    hasMoreAfter: boolean;\n    latestMessageId: string | null;\n  } | null;\n  mascotMotion: {\n`,
    "AppState search focus",
  );
  source = replaceOnce(
    source,
    `  | { type: "messagesHydrated"; threadId: string; messages: Message[] }\n`,
    `  | { type: "messagesHydrated"; threadId: string; messages: Message[] }\n  | {\n      type: "focusMessage";\n      botId: string;\n      threadId: string;\n      messageId: string;\n      messages: Message[];\n      hasMoreAfter: boolean;\n      latestMessageId: string | null;\n    }\n  | { type: "latestMessages"; threadId: string; messages: Message[] }\n`,
    "search focus actions",
  );
  source = replaceOnce(
    source,
    `    case "select":\n      return updateBot(\n        withMascotMotion({ ...state, selectedId: action.id }, action.id, "switch"),\n`,
    `    case "select":\n      return updateBot(\n        withMascotMotion({ ...state, selectedId: action.id, searchFocus: null }, action.id, "switch"),\n`,
    "select clears focus",
  );
  source = replaceOnce(
    source,
    `        mascotMotion: state.mascotMotion?.botId === action.botId ? null : state.mascotMotion,\n      };\n`,
    `        mascotMotion: state.mascotMotion?.botId === action.botId ? null : state.mascotMotion,\n        searchFocus: state.searchFocus?.botId === action.botId ? null : state.searchFocus,\n      };\n`,
    "delete clears focus",
  );
  source = replaceOnce(
    source,
    `    case "messagesHydrated": {\n      const bot = state.bots.find((candidate) => candidate.threadId === action.threadId);\n      if (!bot) return state;\n      return updateBot(state, bot.id, (candidate) => ({\n        ...candidate,\n        messages: mergeThreadMessages(candidate.messages, action.messages),\n      }));\n    }\n`,
    `    case "messagesHydrated": {\n      const bot = state.bots.find((candidate) => candidate.threadId === action.threadId);\n      if (!bot) return state;\n      return updateBot(state, bot.id, (candidate) => ({\n        ...candidate,\n        messages: mergeThreadMessages(candidate.messages, action.messages),\n      }));\n    }\n    case "focusMessage": {\n      const bot = state.bots.find((candidate) => candidate.id === action.botId && candidate.threadId === action.threadId);\n      if (!bot) return state;\n      const next = withMascotMotion(\n        {\n          ...state,\n          selectedId: bot.id,\n          searchFocus: {\n            botId: bot.id,\n            messageId: action.messageId,\n            hasMoreAfter: action.hasMoreAfter,\n            latestMessageId: action.latestMessageId,\n          },\n        },\n        bot.id,\n        "switch",\n      );\n      return updateBot(next, bot.id, (candidate) => ({ ...candidate, unread: false, messages: action.messages }));\n    }\n    case "latestMessages": {\n      const bot = state.bots.find((candidate) => candidate.threadId === action.threadId);\n      if (!bot) return state;\n      return updateBot({ ...state, searchFocus: null }, bot.id, (candidate) => ({\n        ...candidate,\n        messages: action.messages,\n      }));\n    }\n`,
    "focus reducers",
  );
  source = replaceOnce(
    source,
    `  error: null,\n  mascotMotion: null,\n`,
    `  error: null,\n  searchFocus: null,\n  mascotMotion: null,\n`,
    "initial focus",
  );
  return source;
});

edit("src/components/Sidebar.tsx", (input) => {
  let source = input;
  source = replaceOnce(source, `  Loader2,\n  Pencil,\n`, `  Loader2,\n  MessageSquareText,\n  Pencil,\n`, "message search icon");
  source = replaceOnce(
    source,
    `const isMacElectron = electronPlatform === "darwin";\n`,
    `const isMacElectron = electronPlatform === "darwin";\n\ninterface TranscriptSearchHit {\n  threadId: string;\n  messageId: string;\n  at: number;\n  role: "bot" | "user";\n  kind: string;\n  preview: string;\n  botId: string;\n  botName: string;\n}\n`,
    "search hit type",
  );
  source = replaceOnce(
    source,
    `  const [query, setQuery] = useState("");\n  const searchRef = useRef<HTMLInputElement>(null);\n`,
    `  const [query, setQuery] = useState("");\n  const [messageHits, setMessageHits] = useState<TranscriptSearchHit[]>([]);\n  const [messageSearchLoading, setMessageSearchLoading] = useState(false);\n  const [messageSearchUnavailable, setMessageSearchUnavailable] = useState(false);\n  const [openingMessageId, setOpeningMessageId] = useState<string | null>(null);\n  const searchRef = useRef<HTMLInputElement>(null);\n`,
    "search state",
  );
  source = replaceOnce(
    source,
    `  const visibleBots = useMemo(() => {\n`,
    `  useEffect(() => {\n    const needle = query.trim();\n    if (needle.length < 2) {\n      setMessageHits([]);\n      setMessageSearchLoading(false);\n      setMessageSearchUnavailable(false);\n      return;\n    }\n    const controller = new AbortController();\n    const timer = window.setTimeout(() => {\n      setMessageSearchLoading(true);\n      setMessageSearchUnavailable(false);\n      void api(\`/api/search/messages?q=\${encodeURIComponent(needle)}&limit=16\`, { signal: controller.signal })\n        .then((body) => {\n          if (!controller.signal.aborted) {\n            setMessageHits(Array.isArray(body.hits) ? body.hits : []);\n            setMessageSearchUnavailable(body.available === false);\n          }\n        })\n        .catch((error) => {\n          if (!controller.signal.aborted) {\n            console.warn("Transcript search failed", error);\n            setMessageHits([]);\n            setMessageSearchUnavailable(true);\n          }\n        })\n        .finally(() => { if (!controller.signal.aborted) setMessageSearchLoading(false); });\n    }, 180);\n    return () => {\n      controller.abort();\n      window.clearTimeout(timer);\n    };\n  }, [query]);\n\n  const openTranscriptHit = async (hit: TranscriptSearchHit) => {\n    setOpeningMessageId(hit.messageId);\n    try {\n      const window = await api(\n        \`/api/bots/\${encodeURIComponent(hit.botId)}/messages?around=\${encodeURIComponent(hit.messageId)}&limit=120\`,\n      );\n      dispatch({\n        type: "focusMessage",\n        botId: hit.botId,\n        threadId: hit.threadId,\n        messageId: hit.messageId,\n        messages: window.messages ?? [],\n        hasMoreAfter: Boolean(window.hasMoreAfter),\n        latestMessageId: window.latestMessageId ?? null,\n      });\n    } catch (error) {\n      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });\n    } finally {\n      setOpeningMessageId(null);\n    }\n  };\n\n  const visibleBots = useMemo(() => {\n`,
    "debounced transcript search",
  );
  source = replaceOnce(
    source,
    `            placeholder="Search"\n            aria-label="Search bots"\n`,
    `            placeholder="Search bots and messages"\n            aria-label="Search bots and messages"\n`,
    "search label",
  );
  source = replaceOnce(
    source,
    `      {/* Bot list */}\n      <div className="flex-1 overflow-y-auto px-2">\n        <div className="flex flex-col gap-0.5">\n`,
    `      {/* Bots + transcript search results */}\n      <div className="flex-1 overflow-y-auto px-2">\n        <div className="flex flex-col gap-0.5">\n          {query.trim().length >= 2 && (messageHits.length > 0 || messageSearchLoading || messageSearchUnavailable) && (\n            <div className="mb-2">\n              <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">\n                <MessageSquareText size={12} /> Messages\n                {messageSearchLoading && <Loader2 size={11} className="ml-auto animate-spin" />}\n              </div>\n              {messageHits.map((hit) => (\n                <button\n                  key={\`\${hit.threadId}:\${hit.messageId}\`}\n                  onClick={() => void openTranscriptHit(hit)}\n                  disabled={openingMessageId === hit.messageId}\n                  className="group flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-raised/65 disabled:opacity-60"\n                  title={\`Open message in \${hit.botName}\`}\n                >\n                  <MessageSquareText size={15} className="mt-0.5 shrink-0 text-accent" />\n                  <span className="min-w-0 flex-1">\n                    <span className="flex items-center gap-2">\n                      <span className="truncate text-[12px] font-semibold text-ink">{hit.botName}</span>\n                      <span className="shrink-0 text-[10px] text-ink-secondary">{formatTime(hit.at)}</span>\n                    </span>\n                    <span className="mt-0.5 block line-clamp-2 text-[12px] leading-4 text-ink-secondary">{hit.preview || "Visible transcript message"}</span>\n                  </span>\n                  {openingMessageId === hit.messageId && <Loader2 size={12} className="mt-1 animate-spin text-ink-secondary" />}\n                </button>\n              ))}\n              {!messageHits.length && !messageSearchLoading && messageSearchUnavailable && (\n                <div className="px-3 py-2 text-[12px] text-ink-secondary">Local transcript search is unavailable.</div>\n              )}\n            </div>\n          )}\n`,
    "transcript results UI",
  );
  return source;
});

edit("src/components/ChatView.tsx", (input) => {
  let source = input;
  source = replaceOnce(source, `import { useEffect, useRef } from "react";\n`, `import { useEffect, useRef, useState } from "react";\n`, "ChatView useState");
  source = replaceOnce(
    source,
    `import { ArrowRight, Check, FileText, ListChecks, Loader2, Monitor, Square, X } from "lucide-react";\n`,
    `import { ArrowDown, ArrowRight, Check, Download, FileText, ListChecks, Loader2, Monitor, Square, X } from "lucide-react";\n`,
    "ChatView icons",
  );
  source = replaceOnce(
    source,
    `import { useStore, formatTime, type Bot, type Message } from "@/state/store";\n`,
    `import { api, useStore, formatTime, type Bot, type Message } from "@/state/store";\n`,
    "ChatView api import",
  );
  source = replaceOnce(
    source,
    `  const scrollRef = useRef<HTMLDivElement>(null);\n\n  const streaming = state.streaming[bot.threadId];\n`,
    `  const scrollRef = useRef<HTMLDivElement>(null);\n  const focusRef = useRef<HTMLDivElement>(null);\n  const [returningLatest, setReturningLatest] = useState(false);\n  const [exporting, setExporting] = useState(false);\n\n  const focus = state.searchFocus?.botId === bot.id ? state.searchFocus : null;\n  const streaming = state.streaming[bot.threadId];\n`,
    "ChatView focus state",
  );
  source = replaceOnce(
    source,
    `  useEffect(() => {\n    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });\n  }, [bot.id, bot.messages.length, streaming, bot.busy]);\n\n  const first = bot.messages[0];\n`,
    `  useEffect(() => {\n    if (focus) return;\n    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });\n  }, [bot.id, bot.messages.length, streaming, bot.busy, focus]);\n\n  useEffect(() => {\n    if (!focus) return;\n    const frame = requestAnimationFrame(() => {\n      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;\n      focusRef.current?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });\n    });\n    return () => cancelAnimationFrame(frame);\n  }, [focus?.messageId, bot.messages.length]);\n\n  const returnToLatest = async () => {\n    setReturningLatest(true);\n    try {\n      const page = await api(\`/api/bots/\${encodeURIComponent(bot.id)}/messages?limit=80\`);\n      dispatch({ type: "latestMessages", threadId: bot.threadId, messages: page.messages ?? [] });\n    } catch (error) {\n      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });\n    } finally {\n      setReturningLatest(false);\n    }\n  };\n\n  const exportTranscript = async () => {\n    setExporting(true);\n    try {\n      const response = await fetch(\`/api/bots/\${encodeURIComponent(bot.id)}/export?format=markdown\`);\n      if (!response.ok) {\n        const body = await response.json().catch(() => ({}));\n        throw new Error(body.error ?? `Export failed (\${response.status})`);\n      }\n      const blob = await response.blob();\n      const href = URL.createObjectURL(blob);\n      const anchor = document.createElement("a");\n      const safeName = (bot.name || "transcript").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "transcript";\n      anchor.href = href;\n      anchor.download = `\${safeName}.md`;\n      document.body.appendChild(anchor);\n      anchor.click();\n      anchor.remove();\n      URL.revokeObjectURL(href);\n    } catch (error) {\n      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });\n    } finally {\n      setExporting(false);\n    }\n  };\n\n  const first = bot.messages[0];\n`,
    "ChatView focus effects and actions",
  );
  source = replaceOnce(
    source,
    `        <div className="flex items-center gap-2">\n          {bot.busy && (\n`,
    `        <div className="flex items-center gap-2">\n          <button\n            onClick={() => void exportTranscript()}\n            disabled={exporting}\n            className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50"\n            aria-label="Export visible transcript as Markdown"\n            title="Export visible transcript as Markdown"\n          >\n            {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}\n          </button>\n          {bot.busy && (\n`,
    "export button",
  );
  source = replaceOnce(
    source,
    `          {bot.messages.map((m) => {\n            switch (m.kind) {\n              case "options":\n                return <OptionCard key={m.id} botId={bot.id} message={m} />;\n              case "activity":\n                return <ActivityChip key={m.id} message={m} />;\n              case "screen":\n                return m.png ? <ScreenFrame key={m.id} png={m.png} mime={m.mime} /> : null;\n              case "handoff":\n                return <HandoffCard key={m.id} message={m} />;\n              default:\n                return <Bubble key={m.id} message={m} />;\n            }\n          })}\n`,
    `          {focus?.hasMoreAfter && (\n            <div className="sticky top-2 z-10 flex justify-center py-1">\n              <button\n                onClick={() => void returnToLatest()}\n                disabled={returningLatest}\n                className="flex items-center gap-1.5 rounded-full border border-hairline/50 bg-panel/95 px-3 py-1.5 text-[12px] font-medium text-ink shadow-sm backdrop-blur hover:bg-raised disabled:opacity-60"\n              >\n                {returningLatest ? <Loader2 size={13} className="animate-spin" /> : <ArrowDown size={13} />}\n                Return to latest\n              </button>\n            </div>\n          )}\n          {bot.messages.map((m) => {\n            let content: React.ReactNode = null;\n            switch (m.kind) {\n              case "options":\n                content = <OptionCard botId={bot.id} message={m} />;\n                break;\n              case "activity":\n                content = <ActivityChip message={m} />;\n                break;\n              case "screen":\n                content = m.png ? <ScreenFrame png={m.png} mime={m.mime} /> : null;\n                break;\n              case "handoff":\n                content = <HandoffCard message={m} />;\n                break;\n              default:\n                content = <Bubble message={m} />;\n            }\n            if (!content) return null;\n            const focused = focus?.messageId === m.id;\n            return (\n              <div\n                key={m.id}\n                ref={focused ? focusRef : undefined}\n                data-message-id={m.id}\n                className={cn(\n                  "scroll-my-20 rounded-2xl transition-shadow",\n                  focused && "ring-2 ring-accent/55 ring-offset-2 ring-offset-app",\n                )}\n              >\n                {content}\n              </div>\n            );\n          })}\n`,
    "focused message rendering",
  );
  return source;
});

for (const [path, needles] of Object.entries({
  "src/state/store.tsx": ["searchFocus:", 'type: "focusMessage"', 'case "focusMessage"', 'case "latestMessages"'],
  "src/components/Sidebar.tsx": ["TranscriptSearchHit", "Search bots and messages", "openTranscriptHit", "Messages"],
  "src/components/ChatView.tsx": ["Return to latest", "Export visible transcript as Markdown", "focusRef", "ring-accent/55"],
})) {
  const text = readFileSync(path, "utf8");
  for (const needle of needles) if (!text.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
