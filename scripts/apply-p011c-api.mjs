import { readFileSync, writeFileSync } from "node:fs";

const path = "server/index.ts";
let source = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceOnce(
  `import { mentionedBots, parseBotAvatar, Store, type Message } from "./store.ts";\n`,
  `import { mentionedBots, parseBotAvatar, Store, type Message } from "./store.ts";\nimport {\n  TRANSCRIPT_WINDOW_DEFAULT_LIMIT,\n  transcriptExportJson,\n  transcriptExportMarkdown,\n  transcriptMessageWindow,\n} from "./transcript-navigation.ts";\n`,
  "transcript navigation import",
);

replaceOnce(
  `    // onboarding/ask cards persist their answered/dismissed state\n`,
  `    m = path.match(/^\\/api\\/bots\\/([\\w-]+)\\/export$/);\n    if (m && method === "GET") {\n      if (surface !== "local") return json(res, 403, { error: "transcript export is local-only" });\n      const bot = store.bot(m[1]);\n      if (!bot) return json(res, 404, { error: "no such bot" });\n      const format = url.searchParams.get("format") ?? "markdown";\n      if (format !== "markdown" && format !== "json") return json(res, 400, { error: "format must be markdown or json" });\n      const data = format === "json"\n        ? transcriptExportJson(bot, store.messagesFor(bot.threadId))\n        : transcriptExportMarkdown(bot, store.messagesFor(bot.threadId));\n      const safeName = (bot.name || "transcript")\n        .replace(/[^a-zA-Z0-9._-]+/g, "-")\n        .replace(/^-+|-+$/g, "")\n        .slice(0, 80) || "transcript";\n      res.writeHead(200, {\n        ...SECURITY_HEADERS,\n        "cache-control": "no-store",\n        "content-type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",\n        "content-disposition": \`attachment; filename="\${safeName}.\${format === "json" ? "json" : "md"}"\`,\n      });\n      return res.end(data);\n    }\n\n    // onboarding/ask cards persist their answered/dismissed state\n`,
  "local transcript export route",
);

replaceOnce(
  `      const limit = Math.min(parsedLimit, MOBILE_MESSAGE_PAGE_LIMIT_MAX);\n      const all = store.messagesFor(bot.threadId);\n      const before = url.searchParams.get("before") ?? url.searchParams.get("cursor");\n`,
  `      const all = store.messagesFor(bot.threadId);\n      const around = url.searchParams.get("around");\n      if (around !== null) {\n        if (surface !== "local") return json(res, 403, { error: "exact transcript navigation is local-only" });\n        const windowLimit = requestedLimit === null ? TRANSCRIPT_WINDOW_DEFAULT_LIMIT : parsedLimit;\n        return json(res, 200, transcriptMessageWindow(all, around, windowLimit));\n      }\n      const limit = Math.min(parsedLimit, MOBILE_MESSAGE_PAGE_LIMIT_MAX);\n      const before = url.searchParams.get("before") ?? url.searchParams.get("cursor");\n`,
  "exact bounded message window route",
);

for (const needle of [
  "transcript export is local-only",
  "exact transcript navigation is local-only",
  "transcriptMessageWindow(all, around",
]) {
  if (!source.includes(needle)) throw new Error(`missing invariant ${needle}`);
}
writeFileSync(path, source);
