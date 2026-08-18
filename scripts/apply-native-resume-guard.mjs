import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

for (const [path, from, to] of [
  ["server/drivers/claude.ts", 'import { nativeTurnText } from "../turn-context.ts";', 'import { nativeResumeCursor, nativeTurnText } from "../turn-context.ts";'],
  ["server/drivers/acp/core.ts", 'import { nativeTurnText } from "../../turn-context.ts";', 'import { nativeResumeCursor, nativeTurnText } from "../../turn-context.ts";'],
  ["server/drivers/codex.ts", 'import { nativeTurnText } from "../turn-context.ts";', 'import { nativeResumeCursor, nativeTurnText } from "../turn-context.ts";'],
]) replaceOnce(path, from, to, `${path} helper import`);

replaceOnce(
  "server/drivers/claude.ts",
  '      const sessionId = !turn.rebuildContext && typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;',
  '      const sessionId = nativeResumeCursor(turn);',
  "claude native resume guard",
);
replaceOnce(
  "server/drivers/acp/core.ts",
  '            const cursor = !turn.rebuildContext && typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;',
  '            const cursor = nativeResumeCursor(turn);',
  "acp native resume guard",
);
replaceOnce(
  "server/drivers/codex.ts",
  '          const cursor = !turn.rebuildContext && typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;',
  '          const cursor = nativeResumeCursor(turn);',
  "codex native resume guard",
);

replaceOnce(
  "server/turn-context.test.ts",
  '  decideTurnContext,\n  nativeTurnText,',
  '  decideTurnContext,\n  nativeResumeCursor,\n  nativeTurnText,',
  "turn context helper import",
);
replaceOnce(
  "server/turn-context.test.ts",
  'describe("native session rebuild prompt", () => {',
  `describe("native resume guard", () => {
  it("accepts only a non-empty cursor when the session is still trusted", () => {
    expect(nativeResumeCursor({ resumeCursor: "session-a" })).toBe("session-a");
    expect(nativeResumeCursor({ resumeCursor: "   " })).toBeNull();
    expect(nativeResumeCursor({ resumeCursor: 42 })).toBeNull();
  });

  it("refuses every cursor when canonical context must be rebuilt", () => {
    expect(nativeResumeCursor({ resumeCursor: "stale-session", rebuildContext: true })).toBeNull();
  });
});

describe("native session rebuild prompt", () => {`,
  "native resume tests",
);

const anchor = `  it("resumes with --resume when a cursor exists and reports that session id", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-resume", text: "again", resumeCursor: "sess-123" });
    const started = await recorder.until((e) => e.type === "session.started");
    expect(started).toMatchObject({ sessionId: "sess-123" });

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("--resume");
    expect(seen.argv).not.toContain("--session-id");
  });
`;
const addition = `${anchor}
  it("starts a fresh native session and quotes canonical history when the prior cursor is stale", async () => {
    await create();
    const dump = join(scratch, "rebuild.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-rebuild",
      text: "current request",
      resumeCursor: "stale-session",
      rebuildContext: true,
      transcript: [
        { role: "user", text: "previous request" },
        { role: "assistant", text: "previous answer" },
      ],
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--resume");
    expect(seen.argv).toContain("--session-id");
    const content = seen.prompt?.message?.content ?? "";
    expect(content).toContain("USER:\\nprevious request");
    expect(content).toContain("ASSISTANT:\\nprevious answer");
    expect(content).toContain("<current_user_message>\\ncurrent request\\n</current_user_message>");
    expect(content.match(/current request/g)).toHaveLength(1);
  });
`;
replaceOnce("server/drivers/claude.test.ts", anchor, addition, "Claude rebuild driver test");

for (const [path, needles] of Object.entries({
  "server/drivers/claude.ts": ["nativeResumeCursor(turn)", "nativeTurnText(turn)"],
  "server/drivers/acp/core.ts": ["nativeResumeCursor(turn)", "nativeTurnText(turn)"],
  "server/drivers/codex.ts": ["nativeResumeCursor(turn)", "nativeTurnText(turn)"],
  "server/turn-context.test.ts": ['describe("native resume guard"'],
  "server/drivers/claude.test.ts": ["stale-session", "<current_user_message>"],
})) {
  const source = readFileSync(path, "utf8");
  for (const needle of needles) if (!source.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
