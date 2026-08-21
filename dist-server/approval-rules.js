import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { assertPersistenceWritable, loadPersistentJson } from "./persistence-health.js";
export function approvalBoundary(scope) {
    return scope.program ? `${scope.tool}:${scope.program}` : scope.tool;
}
export function approvalAuditText(decision, scope) {
    return `${decision === "allow" ? "Allowed" : "Denied"} by saved rule (${approvalBoundary(scope)})`;
}
/** Keep optimistic UI out of the consent boundary: accepted state is invoked
 * only after the provider settles, while rejection restores a human-answerable
 * request. */
export async function applySavedRuleDecision(send, hooks) {
    try {
        await send();
    }
    catch {
        hooks.rejected();
        return "pending";
    }
    hooks.accepted();
    return "settled";
}
const TOOL = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const PROGRAM = /^[a-z0-9][a-z0-9._+-]{0,63}$/;
const COMMAND_TOOLS = new Set([
    "bash", "shell", "terminal", "execute", "exec", "run", "command", "run_command", "execute_command",
    "computer_exec", "computer.execute", "computer_execute",
]);
const PRIVILEGE = /^(?:sudo|doas|pkexec|runas)$/i;
const SHELL_INTERPRETERS = /^(?:sh|bash|zsh|fish|dash|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|wscript|cscript)$/i;
const HIGH_RISK_PROGRAM = /^(?:rm|rmdir|shred|dd|mkfs|diskutil|chmod|chown|curl|wget|scp|sftp|ssh|rsync|ftp|nc|netcat|socat|telnet|openssl|gpg|security|env|printenv|cat|sh|bash|zsh|fish|dash|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|wscript|cscript|python\d*|node|ruby|perl|php|npm|npx|pnpm|yarn|bun|make|docker|podman|command|exec|nohup|nice|timeout|xargs|find)$/i;
const HIGH_RISK_TOOL = /(?:^|[_.:-])(?:delete|remove|destroy|erase|credential|credentials|secret|secrets|password|token|keychain|private_key|read_file|write_file|filesystem)(?:$|[_.:-])/i;
const CONTROL_OR_COMPOSITION = /[\u0000-\u001f\u007f;&|`<>]|\$\(|\$\{|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i;
const OBFUSCATED = /(?:^|\s)(?:eval|base64|openssl\s+enc|certutil|frombase64string|invoke-expression|iex)(?:\s|$)|(?:^|\s)-(?:enc|encodedcommand)(?:\s|$)/i;
const INTERPRETED_CODE = /(?:^|\s)(?:python\d*|node|ruby|perl|php)(?:\s+[^\s]+)*\s+(?:-c|-e)(?:\s|$)/i;
const DESTRUCTIVE = [
    /\brm\b/i,
    /\b(?:mkfs|shutdown|reboot|halt)\b|\bdiskutil\s+erase\b|\bdd\b[^\n]*\bof=\/dev\//i,
    /:\(\)\s*\{.*\}\s*;?\s*:/,
    /\bgit\s+(?:push\b[^\n]*--force(?:-with-lease)?|reset\s+--hard|clean\s+-[a-z]*f)/i,
    /\b(?:drop\s+(?:table|database)|truncate\s+table)\b/i,
    /\bchmod\s+-R\s+777\s+\//i,
];
const SENSITIVE = [
    /(^|[\s/"'])\.env(?:\.|$|["'\s])/i,
    /\.ssh\/|\bid_(?:rsa|ed25519)\b|authorized_keys/i,
    /\.aws\/credentials|\.netrc|\.npmrc|\.pypirc|\.docker\/config\.json/i,
    /security\s+find-(?:generic|internet)-password|\bkeychain\b/i,
    /\bcredentials?\.json\b|\bserviceaccount\b|\bprivate[_ -]?key\b|\bseed phrase\b/i,
    /\b(?:credential|credentials|token|password|secret|api[_ -]?key|private[_ -]?key|seed phrase)\b/i,
    /\bgit\s+(?:credential|config|push)\b/i,
    /\bgit\s+(?:(?:--?[a-z][a-z-]*)(?:=[^\s]+)?\s+)*(?:-c|--config-env)(?:\s|=)/i,
];
function canonicalTool(value) {
    const tool = value.trim().toLowerCase();
    return TOOL.test(tool) ? tool : null;
}
function bareTool(tool) {
    const marker = tool.lastIndexOf("__");
    const mcpName = tool.startsWith("mcp__") && marker > 4 ? tool.slice(marker + 2) : null;
    return (mcpName ?? tool.split(":").at(-1) ?? tool).replace(/-/g, "_");
}
function commandTool(tool) {
    const bare = bareTool(tool);
    return COMMAND_TOOLS.has(bare) || /(?:^|_)(?:shell|terminal|exec|command)$/.test(bare);
}
function tokenizeSimpleCommand(input) {
    const words = [];
    let current = "";
    let quote = null;
    for (let i = 0; i < input.length; i += 1) {
        const char = input[i];
        if (quote) {
            if (char === quote)
                quote = null;
            else if (char === "\\")
                return null;
            else
                current += char;
            continue;
        }
        if (char === "'" || char === '"')
            quote = char;
        else if (/\s/.test(char)) {
            if (current)
                words.push(current);
            current = "";
        }
        else
            current += char;
    }
    if (quote)
        return null;
    if (current)
        words.push(current);
    return words;
}
function riskReason(text) {
    if (DESTRUCTIVE.some((pattern) => pattern.test(text)))
        return "destructive";
    if (SENSITIVE.some((pattern) => pattern.test(text)))
        return "sensitive";
    return undefined;
}
/** Derive the only durable scope accepted by the broker. Unknown command
 * syntax remains answerable once, but can never become an unattended grant. */
export function deriveApprovalScope(rawTool, summary) {
    const tool = canonicalTool(rawTool);
    if (!tool)
        return { key: null, tool: "unknown", autoAllowEligible: false, reason: "invalid-tool" };
    const directRisk = riskReason(`${tool}\n${summary}`);
    if (!commandTool(tool)) {
        const identityRisk = HIGH_RISK_TOOL.test(tool) ? "sensitive" : undefined;
        const reason = directRisk ?? identityRisk;
        return { key: `v1:tool:${tool}`, tool, autoAllowEligible: !reason, ...(reason ? { reason } : {}) };
    }
    const command = summary.trim();
    if (!command || command.length > 4_096 || CONTROL_OR_COMPOSITION.test(command)) {
        return { key: null, tool, autoAllowEligible: false, reason: "unparseable-command" };
    }
    if (OBFUSCATED.test(command) || INTERPRETED_CODE.test(command)) {
        return { key: null, tool, autoAllowEligible: false, reason: "obfuscated-command" };
    }
    const words = tokenizeSimpleCommand(command);
    if (!words?.length)
        return { key: null, tool, autoAllowEligible: false, reason: "unparseable-command" };
    const index = 0;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) {
        return { key: null, tool, autoAllowEligible: false, reason: "obfuscated-command" };
    }
    const executable = words[index] ?? "";
    const program = executable.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase() ?? "";
    if (!PROGRAM.test(program))
        return { key: null, tool, autoAllowEligible: false, reason: "unparseable-command" };
    if (PRIVILEGE.test(program)) {
        return { key: `v1:command:${tool}:${program}`, tool, program, autoAllowEligible: false, reason: "privilege-escalation" };
    }
    if (HIGH_RISK_PROGRAM.test(program)) {
        const reason = directRisk ?? (/^(?:curl|wget|scp|sftp|ssh|rsync|ftp|nc|netcat|socat|telnet|cat|env|printenv|security|gpg)$/i.test(program)
            ? "sensitive"
            : /^(?:sh|bash|zsh|fish|dash|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|wscript|cscript|python\d*|node|ruby|perl|php)$/i.test(program)
                ? "obfuscated-command"
                : "destructive");
        return { key: `v1:command:${tool}:${program}`, tool, program, autoAllowEligible: false, reason };
    }
    if (SHELL_INTERPRETERS.test(program) && words.slice(index + 1).some((word) => /^(?:-c|\/c|-[a-z]*c[a-z]*)$/i.test(word))) {
        return { key: null, tool, autoAllowEligible: false, reason: "obfuscated-command" };
    }
    return {
        key: `v1:command:${tool}:${program}`,
        tool,
        program,
        autoAllowEligible: !directRisk,
        ...(directRisk ? { reason: directRisk } : {}),
    };
}
const MAX_RULES_PER_BOT = 256;
const RULE_ID = /^approval-[a-f0-9-]{36}$/;
const BOT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const RULE_KEY = /^v1:(?:tool|command):[a-z0-9_.:-]{1,300}$/;
export class ApprovalRuleStore {
    path;
    rules = [];
    constructor(dataDir) {
        this.path = join(dataDir, "approval-rules.json");
        this.reload();
    }
    reload() {
        this.rules = loadPersistentJson(this.path, {
            label: "Scoped approval rules", missing: () => [], resetValue: { version: 1, rules: [] }, maxBytes: 4 * 1024 * 1024,
            validate: (raw) => {
                const document = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
                if (document?.version !== 1)
                    throw new Error("unsupported approval-rule version");
                if (!Array.isArray(document.rules) || document.rules.length > 10_000)
                    throw new Error("invalid approval-rule schema");
                const seen = new Set();
                const counts = new Map();
                for (const row of document.rules) {
                    if (!row || typeof row !== "object")
                        throw new Error("invalid approval rule");
                    const rule = row;
                    const identity = `${rule.botId}\0${rule.key}`;
                    const valid = typeof rule.id === "string" && RULE_ID.test(rule.id)
                        && typeof rule.botId === "string" && BOT_ID.test(rule.botId)
                        && typeof rule.key === "string" && RULE_KEY.test(rule.key)
                        && typeof rule.tool === "string" && canonicalTool(rule.tool) === rule.tool
                        && (rule.program === undefined || (typeof rule.program === "string" && PROGRAM.test(rule.program)))
                        && (rule.decision === "allow" || rule.decision === "deny")
                        && typeof rule.createdAt === "number" && Number.isFinite(rule.createdAt)
                        && typeof rule.updatedAt === "number" && Number.isFinite(rule.updatedAt)
                        && !seen.has(identity)
                        && (counts.get(rule.botId ?? "") ?? 0) < MAX_RULES_PER_BOT;
                    if (!valid)
                        throw new Error("invalid approval rule");
                    seen.add(identity);
                    counts.set(rule.botId, (counts.get(rule.botId) ?? 0) + 1);
                }
                return document.rules;
            },
        });
    }
    list(botId) {
        return this.rules.filter((rule) => rule.botId === botId).map((rule) => ({ ...rule }));
    }
    decide(botId, scope) {
        if (!scope.key)
            return null;
        const rule = this.rules.find((candidate) => candidate.botId === botId && candidate.key === scope.key);
        if (!rule)
            return null;
        if (rule.decision === "allow" && !scope.autoAllowEligible)
            return null;
        return { behavior: rule.decision, rule: { ...rule }, scope };
    }
    remember(botId, scope, decision, now = Date.now()) {
        assertPersistenceWritable(this.path);
        if (!scope.key || (decision === "allow" && !scope.autoAllowEligible))
            return null;
        const existing = this.rules.find((rule) => rule.botId === botId && rule.key === scope.key);
        if (existing) {
            existing.decision = decision;
            existing.updatedAt = now;
            existing.tool = scope.tool;
            existing.program = scope.program;
            this.save();
            return { ...existing };
        }
        if (this.list(botId).length >= MAX_RULES_PER_BOT) {
            throw Object.assign(new Error(`an agent may remember at most ${MAX_RULES_PER_BOT} approval rules`), { status: 409 });
        }
        const rule = {
            id: `approval-${randomUUID()}`,
            botId,
            key: scope.key,
            tool: scope.tool,
            ...(scope.program ? { program: scope.program } : {}),
            decision,
            createdAt: now,
            updatedAt: now,
        };
        this.rules.push(rule);
        this.save();
        return { ...rule };
    }
    revoke(botId, ruleId) {
        assertPersistenceWritable(this.path);
        const next = this.rules.filter((rule) => rule.botId !== botId || rule.id !== ruleId);
        if (next.length === this.rules.length)
            return false;
        this.rules = next;
        this.save();
        return true;
    }
    revokeBot(botId) {
        assertPersistenceWritable(this.path);
        const next = this.rules.filter((rule) => rule.botId !== botId);
        if (next.length === this.rules.length)
            return;
        this.rules = next;
        this.save();
    }
    save() {
        assertPersistenceWritable(this.path);
        const document = { version: 1, rules: this.rules };
        writeFileAtomic(this.path, JSON.stringify(document, null, 2));
    }
}
/** The provider has already acted when this is called. Persistence is
 * deliberately non-throwing so a disk failure cannot invite a replay. */
export function rememberApprovalAfterSettlement(store, botId, scope, decision) {
    try {
        const rule = store.remember(botId, scope, decision);
        return rule
            ? { rule, remembered: true }
            : { rule: null, remembered: false, warning: "The action was settled once, but this scope is not safe to remember." };
    }
    catch {
        return { rule: null, remembered: false, warning: "The action was settled once, but the approval rule could not be saved." };
    }
}
