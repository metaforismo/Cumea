import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ApprovalRuleStore, applySavedRuleDecision, approvalAuditText, deriveApprovalScope, rememberApprovalAfterSettlement } from "./approval-rules.ts";

describe("approval scopes", () => {
  it("separates tool names and command programs without storing whole commands", () => {
    const git = deriveApprovalScope("Bash", "git status --short");
    const rm = deriveApprovalScope("Bash", "rm notes.txt");
    const otherTool = deriveApprovalScope("mcp__repo__bash", "git status");
    expect(git).toMatchObject({ key: "v1:command:bash:git", program: "git", autoAllowEligible: true });
    expect(rm.key).toBe("v1:command:bash:rm");
    expect(otherTool.key).toBe("v1:command:mcp__repo__bash:git");
    expect(git.key).not.toContain("status");
  });

  it("builds an auditable row from the scope without echoing command arguments", () => {
    const scope = deriveApprovalScope("Bash", "git status secret-command-argument");
    expect(approvalAuditText("allow", scope)).toBe("Allowed by saved rule (bash:git)");
    expect(approvalAuditText("allow", scope)).not.toContain("secret-command-argument");
  });

  it.each([
    ["shell", "sudo git status", "privilege-escalation"],
    ["shell", "rm -rf scratch", "destructive"],
    ["shell", "cat ~/.ssh/id_ed25519", "sensitive"],
    ["shell", "echo Zm9v | base64 -d", "unparseable-command"],
    ["shell", "bash -c 'git status'", "obfuscated-command"],
    ["shell", "python -c 'import os'", "obfuscated-command"],
    ["shell", "PATH=/tmp git status", "obfuscated-command"],
    ["shell", "powershell -EncodedCommand Zm9v", "obfuscated-command"],
    ["shell", "git status && rm notes", "unparseable-command"],
    ["shell", "git $(printf status)", "unparseable-command"],
    ["shell", "'unterminated", "unparseable-command"],
  ])("never auto-allows tricky command %s: %s", (tool, summary, reason) => {
    expect(deriveApprovalScope(tool, summary)).toMatchObject({ autoAllowEligible: false, reason });
  });

  it("scopes non-command tools exactly and rejects invalid tool identities", () => {
    expect(deriveApprovalScope("mcp__calendar__read", "today").key).toBe("v1:tool:mcp__calendar__read");
    expect(deriveApprovalScope("calendar.read", "today").key).toBe("v1:tool:calendar.read");
    expect(deriveApprovalScope("calendar read", "today")).toMatchObject({ key: null, reason: "invalid-tool" });
  });

  it.each([
    ["mcp__fs__delete_file", "remove scratch"],
    ["mcp__vault__read_secret", "read value"],
    ["mcp__files__write_file", "save report"],
  ])("never grants a high-risk tool identity: %s", (tool, summary) => {
    expect(deriveApprovalScope(tool, summary)).toMatchObject({ autoAllowEligible: false });
  });

  it.each(["rm", "curl", "wget", "scp", "ssh", "cat", "python", "node", "powershell", "npm", "npx", "docker", "command", "exec", "nohup", "nice", "timeout", "xargs", "find", "make"])(
    "never grants a command program whose future arguments cross the trust boundary: %s",
    (program) => {
      expect(deriveApprovalScope("Bash", `${program} harmless-looking-argument`)).toMatchObject({
        key: `v1:command:bash:${program}`,
        autoAllowEligible: false,
      });
    },
  );

  it.each(["git config --get user.token", "git credential fill", "git push origin main", "git -c alias.status=!whoami status", "git --config-env=http.extraHeader=TOKEN status"])(
    "rechecks sensitive git subcommands even when Bash:git is remembered: %s",
    (command) => expect(deriveApprovalScope("Bash", command)).toMatchObject({
      key: "v1:command:bash:git",
      autoAllowEligible: false,
      reason: "sensitive",
    }),
  );
});

describe("ApprovalRuleStore", () => {
  it("applies exact allow and deny rules and keeps blocked allows fail-safe", () => {
    const dir = mkdtempSync(join(tmpdir(), "cumea-approval-"));
    const store = new ApprovalRuleStore(dir);
    const git = deriveApprovalScope("Bash", "git status");
    const rm = deriveApprovalScope("Bash", "rm notes.txt");
    const destructive = deriveApprovalScope("Bash", "rm -rf scratch");
    expect(store.remember("bot-a", git, "allow", 10)).toMatchObject({ decision: "allow" });
    expect(store.remember("bot-a", rm, "deny", 11)).toMatchObject({ decision: "deny" });
    expect(store.remember("bot-a", destructive, "allow", 12)).toBeNull();
    expect(store.decide("bot-a", deriveApprovalScope("Bash", "git diff"))?.behavior).toBe("allow");
    expect(store.decide("bot-a", deriveApprovalScope("Bash", "rm file"))?.behavior).toBe("deny");
    expect(store.decide("bot-b", git)).toBeNull();
  });

  it("persists only scoped metadata and supports bot-owned revocation", () => {
    const dir = mkdtempSync(join(tmpdir(), "cumea-approval-"));
    const first = new ApprovalRuleStore(dir);
    const scope = deriveApprovalScope("shell", "git status --porcelain argument-marker-not-saved");
    const rule = first.remember("bot-a", scope, "allow", 20)!;
    const raw = readFileSync(join(dir, "approval-rules.json"), "utf8");
    expect(raw).not.toContain("status --porcelain");
    const second = new ApprovalRuleStore(dir);
    expect(second.list("bot-a")).toEqual([rule]);
    expect(second.revoke("bot-b", rule.id)).toBe(false);
    expect(second.revoke("bot-a", rule.id)).toBe(true);
    expect(second.list("bot-a")).toEqual([]);
  });
});

describe("saved-rule provider settlement", () => {
  it("does not mark accepted before the provider settles", async () => {
    let resolve!: () => void;
    const sent = new Promise<void>((done) => { resolve = done; });
    const transitions: string[] = [];
    const applying = applySavedRuleDecision(() => sent, {
      accepted: () => transitions.push("accepted"),
      rejected: () => transitions.push("pending"),
    });
    await Promise.resolve();
    expect(transitions).toEqual([]);
    resolve();
    await expect(applying).resolves.toBe("settled");
    expect(transitions).toEqual(["accepted"]);
  });

  it("reports rule persistence failure as one-shot success instead of throwing", () => {
    const parentFile = join(mkdtempSync(join(tmpdir(), "cumea-approval-bad-parent-")), "not-a-directory");
    writeFileSync(parentFile, "file");
    const result = rememberApprovalAfterSettlement(
      new ApprovalRuleStore(parentFile),
      "bot-a",
      deriveApprovalScope("Bash", "git status"),
      "allow",
    );
    expect(result).toMatchObject({ remembered: false, rule: null });
    expect(result.warning).toContain("settled once");
  });

  it("restores a pending human request when the provider rejects automation", async () => {
    const transitions: string[] = [];
    await expect(applySavedRuleDecision(
      () => Promise.reject(new Error("provider rejected")),
      { accepted: () => transitions.push("accepted"), rejected: () => transitions.push("pending") },
    )).resolves.toBe("pending");
    expect(transitions).toEqual(["pending"]);
  });
});
