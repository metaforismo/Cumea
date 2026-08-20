import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("local file route wiring contract", () => {
  it("keeps capability endpoints explicitly local-only", () => {
    expect(source).toContain('file preview capabilities are local-only');
    expect(source).toContain('/files/resolve');
    expect(source).toContain('/preview|download');
  });

  it("mounts the owner-local bot workspace into provider turns", () => {
    expect(source).toContain('botWorkspaceDirectory(bot.id)');
    expect(source).toContain('cwd: localWorkspace');
  });

  it("stages the bot workspace and revokes capabilities on deletion", () => {
    expect(source).toContain('stageBotWorkspaceForDeletion(bot.id)');
    expect(source).toContain('fileCapabilities.revokeBot(bot.id)');
  });
});
