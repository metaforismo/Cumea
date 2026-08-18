import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const before = readFileSync(path, "utf8");
  const first = before.indexOf(needle);
  if (first < 0 || first !== before.lastIndexOf(needle)) {
    throw new Error(`${label}: expected exactly one match`);
  }
  const after = before.slice(0, first) + replacement + before.slice(first + needle.length);
  writeFileSync(path, after);
}

replaceOnce(
  "server/index.ts",
  '} from "./transcript-navigation.ts";\nimport { WorkspaceStore, type AttachmentRecord, type RoutineSchedule, type TaskSource } from "./workspace.ts";',
  '} from "./transcript-navigation.ts";\nimport { readThreadInspector } from "./thread-inspector.ts";\nimport { WorkspaceStore, type AttachmentRecord, type RoutineSchedule, type TaskSource } from "./workspace.ts";',
  "server inspector import",
);

const inspectorRoute = [
  '    const inspectorMatch = path.match(/^\\/api\\/bots\\/([\\w-]+)\\/inspector$/);',
  '    if (method === "GET" && inspectorMatch) {',
  '      if (surface !== "local") return json(res, 403, { error: "runtime diagnostics are local-only" });',
  '      const bot = store.bot(inspectorMatch[1]);',
  '      if (!bot) return json(res, 404, { error: "no such bot" });',
  '      const rawLimit = url.searchParams.get("limit");',
  '      let limit: number | undefined;',
  '      if (rawLimit !== null) {',
  '        const parsed = Number(rawLimit);',
  '        if (!Number.isInteger(parsed) || parsed < 1) return json(res, 400, { error: "limit must be a positive integer" });',
  '        limit = parsed;',
  '      }',
  '      const inspector = readThreadInspector({',
  '        eventsDir: EVENTS_DIR,',
  '        nativeDir: NATIVE_DIR,',
  '        threadId: bot.threadId,',
  '        limit,',
  '      });',
  '      res.setHeader("cache-control", "no-store");',
  '      return json(res, 200, { inspector });',
  '    }',
  '',
].join("\n");
replaceOnce(
  "server/index.ts",
  "    // ── internal peer-agent comms (localhost + shared token only) ──────",
  inspectorRoute + "    // ── internal peer-agent comms (localhost + shared token only) ──────",
  "server inspector route",
);

replaceOnce(
  "src/components/ChatView.tsx",
  'import { ArrowDown, ArrowRight, Check, Download, FileText, ListChecks, Loader2, Monitor, Square, X } from "lucide-react";',
  'import { ArrowDown, ArrowRight, Bug, Check, Download, FileText, ListChecks, Loader2, Monitor, Square, X } from "lucide-react";',
  "ChatView inspector icon",
);
replaceOnce(
  "src/components/ChatView.tsx",
  'export function ChatView({ bot }: { bot: Bot }) {',
  'export function ChatView({ bot, inspectorOpen = false, onToggleInspector }: { bot: Bot; inspectorOpen?: boolean; onToggleInspector?: () => void }) {',
  "ChatView inspector props",
);

const workButton = [
  '          <button',
  '            onClick={() => dispatch({ type: "toggleWork", tab: "activity" })}',
].join("\n");
const inspectorButton = [
  '          {onToggleInspector ? (',
  '            <button',
  '              onClick={onToggleInspector}',
  '              className={cn(',
  '                "rounded-md p-1.5 hover:bg-raised",',
  '                inspectorOpen ? "text-accent" : "text-ink-secondary hover:text-ink",',
  '              )}',
  '              aria-label="Open local runtime inspector"',
  '              title="Runtime inspector: events and raw provider diagnostics"',
  '            >',
  '              <Bug size={18} />',
  '            </button>',
  '          ) : null}',
  workButton,
].join("\n");
replaceOnce(
  "src/components/ChatView.tsx",
  workButton,
  inspectorButton,
  "ChatView inspector button",
);

for (const [path, needles] of Object.entries({
  "server/index.ts": ['readThreadInspector', '/inspector$/', 'runtime diagnostics are local-only'],
  "src/components/ChatView.tsx": ['Bug, Check', 'inspectorOpen = false', 'Open local runtime inspector'],
})) {
  const text = readFileSync(path, "utf8");
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`${path}: missing ${needle}`);
  }
}
