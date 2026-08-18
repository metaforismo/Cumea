import { readFileSync, writeFileSync } from "node:fs";

const path = "server/index.test.ts";
let source = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceOnce(
  `import { ATTACHMENT_MAX_COUNT_PER_BOT } from "./workspace.ts";\n`,
  `import { TranscriptStore } from "./transcript-store.ts";\nimport { ATTACHMENT_MAX_COUNT_PER_BOT } from "./workspace.ts";\n`,
  "TranscriptStore import",
);

replaceOnce(
  `  for (const target of [\n    { label: "transcript", relative: (threadId: string) => \`messages-\${threadId}.json\` },\n    { label: "event log", relative: (threadId: string) => join("events", \`\${threadId}.ndjson\`) },\n    { label: "native log", relative: (threadId: string) => join("native", \`\${threadId}.ndjson\`) },\n  ]) {\n    it(\`keeps all records and restores prepared files when the \${target.label} path is blocked\`, async () => {\n      const created = await api("POST", "/api/bots");\n      const bot = created.body.bot;\n      const routine = await api("POST", "/api/routines", {\n        botId: bot.id,\n        name: \`Survive blocked \${target.label}\`,\n        prompt: "Remain scheduled until deletion can complete",\n        schedule: { kind: "interval", everyMinutes: 30 },\n      });\n      expect(routine.status).toBe(201);\n\n      const transcript = join(home, ".cumea", \`messages-\${bot.threadId}.json\`);\n      const transcriptBefore = readFileSync(transcript, "utf8");\n      const blockedPath = join(home, ".cumea", target.relative(bot.threadId));\n      rmSync(blockedPath, { recursive: true, force: true });\n      mkdirSync(blockedPath, { recursive: true });\n\n      const failed = await api("DELETE", \`/api/bots/\${bot.id}\`);\n      expect(failed).toMatchObject({ status: 500, body: { error: \`could not stage bot \${target.label}\` } });\n      expect((await api("GET", "/api/bots")).body.bots).toContainEqual(expect.objectContaining({ id: bot.id }));\n      expect((await api("GET", "/api/work")).body.workspace.routines).toContainEqual(\n        expect.objectContaining({ id: routine.body.routine.id, botId: bot.id }),\n      );\n      expect(existsSync(blockedPath)).toBe(true);\n      if (target.label !== "transcript") {\n        expect(readFileSync(transcript, "utf8")).toBe(transcriptBefore);\n      }\n\n      rmSync(blockedPath, { recursive: true, force: true });\n      expect((await api("DELETE", \`/api/bots/\${bot.id}\`)).status).toBe(200);\n    });\n  }\n`,
  `  for (const target of [\n    { label: "transcript", relative: (threadId: string) => \`messages-\${threadId}.json\`, legacyAnchor: true },\n    { label: "event log", relative: (threadId: string) => join("events", \`\${threadId}.ndjson\`), legacyAnchor: false },\n    { label: "native log", relative: (threadId: string) => join("native", \`\${threadId}.ndjson\`), legacyAnchor: false },\n  ]) {\n    it(\`keeps all records and restores canonical state when the \${target.label} path is blocked\`, async () => {\n      const created = await api("POST", "/api/bots");\n      const bot = created.body.bot;\n      const routine = await api("POST", "/api/routines", {\n        botId: bot.id,\n        name: \`Survive blocked \${target.label}\`,\n        prompt: "Remain scheduled until deletion can complete",\n        schedule: { kind: "interval", everyMinutes: 30 },\n      });\n      expect(routine.status).toBe(201);\n\n      const blockedPath = join(home, ".cumea", target.relative(bot.threadId));\n      // New canonical-only bots never write messages-<thread>.json. Create an\n      // explicit legacy recovery anchor only for the transcript staging case,\n      // modelling a bot that was migrated from the pre-P0.11b format.\n      if (target.legacyAnchor) writeFileSync(blockedPath, JSON.stringify(bot.messages ?? []));\n      rmSync(blockedPath, { recursive: true, force: true });\n      mkdirSync(blockedPath, { recursive: true });\n\n      const failed = await api("DELETE", \`/api/bots/\${bot.id}\`);\n      expect(failed).toMatchObject({ status: 500, body: { error: \`could not stage bot \${target.label}\` } });\n      expect((await api("GET", "/api/bots")).body.bots).toContainEqual(expect.objectContaining({ id: bot.id }));\n      expect((await api("GET", "/api/work")).body.workspace.routines).toContainEqual(\n        expect.objectContaining({ id: routine.body.routine.id, botId: bot.id }),\n      );\n      const search = await api("GET", "/api/search/messages?q=nice%20to%20meet&limit=50");\n      expect(search.body.hits).toEqual(expect.arrayContaining([expect.objectContaining({ botId: bot.id })]));\n      const canonical = new TranscriptStore(join(home, ".cumea", "transcripts.sqlite"));\n      try {\n        expect(canonical.threadState(bot.threadId)).toMatchObject({ state: "active" });\n      } finally {\n        canonical.close();\n      }\n      expect(existsSync(blockedPath)).toBe(true);\n\n      rmSync(blockedPath, { recursive: true, force: true });\n      expect((await api("DELETE", \`/api/bots/\${bot.id}\`)).status).toBe(200);\n      const after = new TranscriptStore(join(home, ".cumea", "transcripts.sqlite"));\n      try {\n        expect(after.threadState(bot.threadId)).toBeNull();\n      } finally {\n        after.close();\n      }\n    });\n  }\n`,
  "canonical deletion rollback loop",
);

for (const needle of [
  'import { TranscriptStore } from "./transcript-store.ts";',
  "keeps all records and restores canonical state",
  "modelling a bot that was migrated",
]) {
  if (!source.includes(needle)) throw new Error(`missing invariant: ${needle}`);
}
writeFileSync(path, source);
