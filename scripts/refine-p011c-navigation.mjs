import { readFileSync, writeFileSync } from "node:fs";

const path = "src/state/store.tsx";
let source = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

const needle = [
  '        case "select": {',
  '          const bot = stateRef.current.bots.find((b) => b.id === action.id);',
  '          if (bot?.unread) {',
  '            api(`/api/bots/${action.id}`, { method: "PATCH", body: JSON.stringify({ unread: false }) }).catch(() => {});',
  '          }',
  '          if (',
  '            bot &&',
  '            !loadedThreadsRef.current.has(bot.threadId) &&',
  '            !loadingThreadsRef.current.has(bot.threadId)',
  '          ) {',
  '            loadingThreadsRef.current.add(bot.threadId);',
  '            api(`/api/bots/${bot.id}/messages?limit=80`)',
  '              .then(({ messages }) => {',
  '                loadedThreadsRef.current.add(bot.threadId);',
  '                rawDispatch({ type: "messagesHydrated", threadId: bot.threadId, messages });',
  '              })',
  '              .catch(showError)',
  '              .finally(() => loadingThreadsRef.current.delete(bot.threadId));',
  '          }',
  '          break;',
  '        }',
].join("\n");

const replacement = [
  '        case "select": {',
  '          const current = stateRef.current;',
  '          const bot = current.bots.find((b) => b.id === action.id);',
  '          const returningFromSearch = current.searchFocus?.botId === action.id;',
  '          if (bot?.unread) {',
  '            api(`/api/bots/${action.id}`, { method: "PATCH", body: JSON.stringify({ unread: false }) }).catch(() => {});',
  '          }',
  '          if (',
  '            bot &&',
  '            (returningFromSearch || !loadedThreadsRef.current.has(bot.threadId)) &&',
  '            !loadingThreadsRef.current.has(bot.threadId)',
  '          ) {',
  '            loadingThreadsRef.current.add(bot.threadId);',
  '            api(`/api/bots/${bot.id}/messages?limit=80`)',
  '              .then(({ messages }) => {',
  '                loadedThreadsRef.current.add(bot.threadId);',
  '                rawDispatch(returningFromSearch',
  '                  ? { type: "latestMessages", threadId: bot.threadId, messages }',
  '                  : { type: "messagesHydrated", threadId: bot.threadId, messages });',
  '              })',
  '              .catch(showError)',
  '              .finally(() => loadingThreadsRef.current.delete(bot.threadId));',
  '          }',
  '          break;',
  '        }',
].join("\n");

replaceOnce(needle, replacement, "select returns from historical search window");
for (const required of ["returningFromSearch", 'type: "latestMessages"', "current.searchFocus?.botId"]) {
  if (!source.includes(required)) throw new Error(`missing invariant: ${required}`);
}
writeFileSync(path, source);
