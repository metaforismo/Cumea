import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || first !== source.lastIndexOf(before)) throw new Error(`${label}: expected exactly one anchor`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one match, found ${matches.length}`);
  return source.replace(pattern, replacement);
}

let server = readFileSync("server/index.ts", "utf8");
server = replaceOnce(
  server,
  'import { assertBusySteeringCapacity, coalesceBusySteering, queuedSteering } from "./busy-steering.ts";\n',
  'import { assertBusySteeringCapacity, coalesceBusySteering, queuedSteering } from "./busy-steering.ts";\n' +
    'import { buildStructuredPreview } from "./document-preview.ts";\n' +
    'import { FileCapabilityStore, botWorkspaceDirectory, publicFileCapability, readLocalBotFile, readStoredAttachmentFile, stageBotWorkspaceForDeletion } from "./file-capabilities.ts";\n',
  "server imports",
);
server = replaceOnce(
  server,
  'const pairing = new PairingStore();\n',
  'const pairing = new PairingStore();\nconst fileCapabilities = new FileCapabilityStore();\n',
  "capability store",
);
server = replaceOnce(
  server,
  '  "script-src \'self\'",\n',
  '  "script-src \'self\'",\n  "worker-src \'self\'",\n',
  "CSP worker",
);
server = replaceOnce(
  server,
  '  const selection = { ...bot.modelSelection };\n\n  const task = opts.track === false\n',
  '  const selection = { ...bot.modelSelection };\n  const localWorkspace = botWorkspaceDirectory(bot.id);\n\n  const task = opts.track === false\n',
  "turn workspace",
);
server = replaceOnce(
  server,
  '        rebuildContext: turnContext.rebuildContext,\n        system:\n          persona +\n',
  '        rebuildContext: turnContext.rebuildContext,\n        cwd: localWorkspace,\n        system:\n          persona +\n          " When you create a user-facing file, write it inside the current working directory and cite it with a relative path such as ./report.md, ./report.pdf, or ./report.docx so Cumea can offer a safe preview." +\n',
  "turn cwd and file hint",
);

const fileRoutes = String.raw`
    m = path.match(/^\/api\/bots\/([\w-]+)\/files\/resolve$/);
    if (m && method === "POST") {
      if (surface !== "local") return json(res, 403, { error: "file preview capabilities are local-only" });
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const capability = fileCapabilities.issue(bot.id, readLocalBotFile(bot.id, body.path));
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { file: publicFileCapability(capability) });
    }

    m = path.match(/^\/api\/attachments\/([\w-]+)\/files\/resolve$/);
    if (m && method === "POST") {
      if (surface !== "local") return json(res, 403, { error: "file preview capabilities are local-only" });
      const attachment = workspace.attachment(m[1]);
      if (!attachment) return json(res, 404, { error: "no such attachment" });
      const bot = store.bot(attachment.botId);
      if (!bot) return json(res, 404, { error: "attachment owner no longer exists" });
      const capability = fileCapabilities.issue(
        bot.id,
        readStoredAttachmentFile(attachment.storedPath, attachment.name),
      );
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { file: publicFileCapability(capability) });
    }

    m = path.match(/^\/api\/files\/([A-Za-z0-9_-]{43})\/(preview|download)$/);
    if (m && method === "GET") {
      if (surface !== "local") return json(res, 403, { error: "file preview capabilities are local-only" });
      const capability = fileCapabilities.get(m[1]);
      if (!capability) return json(res, 404, { error: "file preview expired or was revoked" });
      const encodedName = encodeURIComponent(capability.name);
      if (m[2] === "download") {
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "cache-control": "no-store",
          "content-type": capability.mime,
          "content-length": String(capability.bytes.length),
          "content-disposition": `attachment; filename*=UTF-8''${encodedName}`,
        });
        return res.end(capability.bytes);
      }
      if (capability.kind === "pdf") {
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "cache-control": "no-store",
          "content-type": "application/pdf",
          "content-length": String(capability.bytes.length),
          "content-disposition": `attachment; filename*=UTF-8''${encodedName}`,
        });
        return res.end(capability.bytes);
      }
      const preview = await buildStructuredPreview(capability.kind, capability.bytes);
      const data = Buffer.from(JSON.stringify({ preview }));
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "content-length": String(data.length),
      });
      return res.end(data);
    }

`;
server = replaceOnce(
  server,
  '    m = path.match(/^\\/api\\/bots\\/([\\w-]+)\\/attachments$/);\n',
  fileRoutes + '    m = path.match(/^\\/api\\/bots\\/([\\w-]+)\\/attachments$/);\n',
  "file routes",
);
server = replaceOnce(
  server,
  '      let stagedFiles: StagedFileDeletion | null = null;\n      let workspaceTransaction: ReturnType<typeof workspace.removeBotDataTransaction> | null = null;\n',
  '      let stagedFiles: StagedFileDeletion | null = null;\n      let stagedBotWorkspace: StagedFileDeletion | null = null;\n      let workspaceTransaction: ReturnType<typeof workspace.removeBotDataTransaction> | null = null;\n',
  "workspace deletion declaration",
);
server = replaceOnce(
  server,
  '      try {\n        // Same-volume rename is the prepare phase: no bytes are destroyed\n',
  '      try {\n        stagedBotWorkspace = stageBotWorkspaceForDeletion(bot.id);\n        // Same-volume rename is the prepare phase: no bytes are destroyed\n',
  "workspace deletion prepare",
);
server = replaceOnce(
  server,
  '        stagedFiles.purge();\n        botTransaction.finalize();\n',
  '        stagedBotWorkspace.purge();\n        stagedFiles.purge();\n        botTransaction.finalize();\n',
  "workspace deletion purge",
);
server = replaceOnce(
  server,
  '          botTransaction?.rollback,\n          workspaceTransaction?.rollback,\n          stagedFiles?.rollback,\n',
  '          botTransaction?.rollback,\n          workspaceTransaction?.rollback,\n          stagedBotWorkspace?.rollback,\n          stagedFiles?.rollback,\n',
  "workspace deletion rollback",
);
server = replaceOnce(
  server,
  '      try { sessionFreshness.delete(bot.threadId); } catch (error) { console.error("could not remove session freshness metadata", error); }\n      broadcast(\n',
  '      fileCapabilities.revokeBot(bot.id);\n      try { sessionFreshness.delete(bot.threadId); } catch (error) { console.error("could not remove session freshness metadata", error); }\n      broadcast(\n',
  "capability revoke",
);
writeFileSync("server/index.ts", server);

let chat = readFileSync("src/components/ChatView.tsx", "utf8");
chat = replaceOnce(chat, 'import { useEffect, useRef, useState } from "react";\n', 'import { useCallback, useEffect, useRef, useState } from "react";\n', "ChatView React import");
chat = replaceOnce(
  chat,
  'import { cn } from "@/lib/cn";\n',
  'import { cn } from "@/lib/cn";\nimport { SafeMarkdown } from "./SafeMarkdown";\nimport { FileViewer, type FileCapabilityView } from "./FileViewer";\n',
  "ChatView viewer imports",
);
chat = replaceRegexOnce(
  chat,
  /\/\/ Minimal markdown for bot bubbles:[\s\S]*?\nfunction Bubble\(\{ message \}: \{ message: Message \}\) \{/,
  `function checkedFileCapability(value: unknown): FileCapabilityView {\n  const file = value && typeof value === "object" ? value as Record<string, unknown> : null;\n  if (\n    !file || typeof file.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(file.token) ||\n    typeof file.name !== "string" || !file.name || file.name.length > 180 || /[\\u0000-\\u001f\\u007f]/.test(file.name) ||\n    typeof file.mime !== "string" || file.mime.length > 120 ||\n    !["markdown", "pdf", "docx"].includes(String(file.kind)) ||\n    !["workspace", "attachment"].includes(String(file.source)) ||\n    typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 25 * 1024 * 1024 ||\n    typeof file.expiresAt !== "number" || !Number.isFinite(file.expiresAt)\n  ) throw new Error("The host returned an invalid file capability");\n  return {\n    token: file.token, name: file.name, mime: file.mime, kind: file.kind as FileCapabilityView["kind"],\n    size: file.size, source: file.source as FileCapabilityView["source"], expiresAt: file.expiresAt,\n  };\n}\n\nfunction Bubble({ message, onOpenPath, onOpenAttachment }: { message: Message; onOpenPath: (path: string) => void; onOpenAttachment: (id: string) => void }) {`,
  "ChatView markdown replacement",
);
chat = replaceOnce(
  chat,
  '        {user ? message.text : <Markdownish text={message.text ?? ""} />}\n',
  '        {user ? message.text : <SafeMarkdown text={message.text ?? ""} onOpenFile={onOpenPath} />}\n',
  "bubble markdown",
);
chat = replaceOnce(
  chat,
  '              <a\n                key={attachment.id}\n                href={`/api/attachments/${attachment.id}`}\n                className="flex max-w-[260px] items-center gap-2 rounded-lg bg-inset px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised"\n              >\n                <FileText size={13} className="shrink-0 text-ink-secondary" />\n                <span className="truncate">{attachment.name}</span>\n              </a>\n',
  '              <button\n                type="button"\n                key={attachment.id}\n                onClick={() => onOpenAttachment(attachment.id)}\n                className="flex max-w-[260px] items-center gap-2 rounded-lg bg-inset px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised"\n              >\n                <FileText size={13} className="shrink-0 text-ink-secondary" />\n                <span className="truncate">{attachment.name}</span>\n              </button>\n',
  "attachment button",
);
chat = replaceOnce(chat, 'function StreamingBubble({ text }: { text: string }) {\n', 'function StreamingBubble({ text, onOpenPath }: { text: string; onOpenPath: (path: string) => void }) {\n', "streaming signature");
chat = replaceOnce(chat, '        <Markdownish text={text} />\n', '        <SafeMarkdown text={text} onOpenFile={onOpenPath} />\n', "streaming markdown");
chat = replaceOnce(
  chat,
  '  const [exporting, setExporting] = useState(false);\n\n',
  '  const [exporting, setExporting] = useState(false);\n  const [fileViewer, setFileViewer] = useState<FileCapabilityView | null>(null);\n\n',
  "viewer state",
);
chat = replaceOnce(
  chat,
  '  const first = bot.messages[0];\n\n  return (\n',
  `  useEffect(() => { setFileViewer(null); }, [bot.id]);\n\n  const resolveFile = useCallback(async (endpoint: string, path?: string) => {\n    try {\n      const body = await api(endpoint, {\n        method: "POST",\n        ...(path !== undefined ? { body: JSON.stringify({ path }) } : {}),\n      });\n      setFileViewer(checkedFileCapability(body.file));\n    } catch (error) {\n      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });\n    }\n  }, [dispatch]);\n  const openPath = useCallback((path: string) => void resolveFile(\`/api/bots/\${encodeURIComponent(bot.id)}/files/resolve\`, path), [bot.id, resolveFile]);\n  const openAttachment = useCallback((id: string) => void resolveFile(\`/api/attachments/\${encodeURIComponent(id)}/files/resolve\`), [resolveFile]);\n\n  const first = bot.messages[0];\n\n  return (\n`,
  "viewer callbacks",
);
chat = replaceOnce(chat, '                content = <Bubble message={m} />;\n', '                content = <Bubble message={m} onOpenPath={openPath} onOpenAttachment={openAttachment} />;\n', "bubble call");
chat = replaceOnce(chat, '            <StreamingBubble text={streaming} />\n', '            <StreamingBubble text={streaming} onOpenPath={openPath} />\n', "streaming call");
chat = replaceOnce(chat, '      <Composer bot={bot} />\n    </main>\n', '      <Composer bot={bot} />\n      {fileViewer && <FileViewer file={fileViewer} onClose={() => setFileViewer(null)} />}\n    </main>\n', "viewer overlay");
writeFileSync("src/components/ChatView.tsx", chat);
