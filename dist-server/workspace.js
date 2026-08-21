import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { writeFileAtomic } from "./atomic.js";
import { DATA_DIR } from "./config.js";
import { newId } from "./contracts.js";
import { ROUTINE_CATCH_UP_WINDOW_MS, nextOccurrence, projectFromOccurrence, validateSchedule, } from "./routines.js";
import { purgeCommittedFileDeletions, stageFilesForDeletion, } from "./delete-files.js";
import { attemptIdempotencyKey, boundedEffectResult, effectAudit, effectBaseFingerprint, effectRequestHash, isExternalEffectNotApplied, normalizeEffectDescriptor, } from "./effect-ledger.js";
import { checkpointCursorDigest, createRunCheckpoint, validRunCheckpoint, } from "./run-checkpoint.js";
import { parseTaskBudget, validTaskBudgetUsage, } from "./task-budget.js";
import { assertPersistenceWritable, loadPersistentJson } from "./persistence-health.js";
export { nextOccurrence, validateSchedule } from "./routines.js";
const WORKSPACE_FILE = join(DATA_DIR, "workspace.json");
const MAX_HISTORY = 500;
export const ROUTINE_NAME_MAX_LENGTH = 100;
export const ROUTINE_PROMPT_MAX_LENGTH = 20_000;
export const EVIDENCE_REQUIREMENT_MAX_COUNT = 20;
export const EVIDENCE_LABEL_MAX_LENGTH = 500;
export const EVIDENCE_MAX_PER_RUN = 200;
export const EFFECT_MAX_PER_RUN = 500;
export const EFFECT_AUDIT_MAX_PER_RECEIPT = 100;
// Persistent per-bot quotas bound authenticated storage growth across restarts.
// The existing per-file HTTP limit remains 25 MiB.
export const ATTACHMENT_MAX_COUNT_PER_BOT = 100;
export const ATTACHMENT_MAX_BYTES_PER_BOT = 250 * 1024 * 1024;
const emptyData = () => ({
    sections: [],
    attachments: [],
    tasks: [],
    runs: [],
    routines: [],
});
function taskTitle(prompt) {
    const oneLine = prompt.replace(/\s+/g, " ").trim();
    return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine || "Untitled task";
}
function boundedEvidenceLabel(value) {
    if (typeof value !== "string")
        throw Object.assign(new Error("evidence label must be a string"), { status: 400 });
    const label = value.trim();
    if (!label)
        throw Object.assign(new Error("evidence label is required"), { status: 400 });
    if (label.length > EVIDENCE_LABEL_MAX_LENGTH) {
        throw Object.assign(new Error("evidence label is too long"), { status: 400 });
    }
    return label;
}
function evidenceDigest(value) {
    return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
function appendEffectAudit(effect, audit) {
    effect.audit.push(audit);
    effect.audit = effect.audit.slice(-EFFECT_AUDIT_MAX_PER_RECEIPT);
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validRequirement(value) {
    if (!isRecord(value))
        return false;
    return typeof value.id === "string" && /^[\w-]{1,100}$/.test(value.id)
        && typeof value.label === "string" && value.label.length > 0 && value.label.length <= EVIDENCE_LABEL_MAX_LENGTH
        && Number.isSafeInteger(value.createdAt) && Number(value.createdAt) >= 0;
}
const EFFECT_HASH = /^sha256:[a-f0-9]{64}$/;
const EFFECT_PART = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
const EFFECT_SECRETISH = /bearer\s+|token|password|secret|api[_-]?key|https?:\/\/|@|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\bxox[baprs]-[A-Za-z0-9-]{16,}/i;
function assertPersistedEffect(value, run) {
    if (!isRecord(value))
        throw new Error("workspace contains a corrupt external-effect receipt");
    const allowed = new Set([
        "id", "runId", "taskId", "botId", "stepId", "itemId", "origin", "descriptor", "requestHash",
        "idempotencyKey", "fingerprint", "attempt", "retryOf", "state", "result", "audit", "createdAt", "updatedAt",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key)) ||
        typeof value.id !== "string" || !/^effect-[\w-]{1,100}$/.test(value.id) ||
        value.runId !== run.id || value.taskId !== run.taskId || value.botId !== run.botId ||
        !["controlled", "provider_observation"].includes(String(value.origin)) ||
        !["intended", "applying", "applied", "failed", "unknown"].includes(String(value.state)) ||
        typeof value.requestHash !== "string" || !EFFECT_HASH.test(value.requestHash) ||
        typeof value.idempotencyKey !== "string" || !EFFECT_HASH.test(value.idempotencyKey) ||
        typeof value.fingerprint !== "string" || !EFFECT_HASH.test(value.fingerprint) ||
        !Number.isSafeInteger(value.attempt) || Number(value.attempt) < 1 || Number(value.attempt) > 10_000 ||
        (value.retryOf !== undefined && typeof value.retryOf !== "string") ||
        (value.itemId !== undefined && (typeof value.itemId !== "string" || value.itemId.length > 200)) ||
        (value.stepId !== undefined && (typeof value.stepId !== "string" || !run.steps.some((step) => step.id === value.stepId))) ||
        !Number.isSafeInteger(value.createdAt) || Number(value.createdAt) < 0 ||
        !Number.isSafeInteger(value.updatedAt) || Number(value.updatedAt) < 0 ||
        !isRecord(value.descriptor) || Object.keys(value.descriptor).some((key) => !["boundary", "action", "targetHint"].includes(key)) ||
        typeof value.descriptor.boundary !== "string" || !EFFECT_PART.test(value.descriptor.boundary) ||
        typeof value.descriptor.action !== "string" || !EFFECT_PART.test(value.descriptor.action) ||
        (value.descriptor.targetHint !== undefined && (typeof value.descriptor.targetHint !== "string" || value.descriptor.targetHint.length > 100 || EFFECT_SECRETISH.test(value.descriptor.targetHint))) ||
        !Array.isArray(value.audit) || value.audit.length < 1 || value.audit.length > EFFECT_AUDIT_MAX_PER_RECEIPT)
        throw new Error("workspace contains a corrupt external-effect receipt");
    const auditIds = new Set();
    for (const audit of value.audit) {
        if (!isRecord(audit) || Object.keys(audit).some((key) => !["id", "event", "at", "note"].includes(key)) ||
            typeof audit.id !== "string" || !/^effect-audit-[\w-]{1,100}$/.test(audit.id) || auditIds.has(audit.id) ||
            !["intended", "applying", "applied", "failed", "restart_unknown", "ambiguous_unknown", "duplicate", "observed_unknown", "user_resolved"].includes(String(audit.event)) ||
            !Number.isSafeInteger(audit.at) || Number(audit.at) < 0 ||
            (audit.note !== undefined && (typeof audit.note !== "string" || audit.note.length > 160 || EFFECT_SECRETISH.test(audit.note))))
            throw new Error("workspace contains a corrupt external-effect audit record");
        auditIds.add(audit.id);
    }
    if (value.result !== undefined) {
        if (!isRecord(value.result) || Object.keys(value.result).some((key) => !["ok", "kind", "code", "reference", "digest"].includes(key)) ||
            typeof value.result.ok !== "boolean" || typeof value.result.kind !== "string" || value.result.kind.length > 20 ||
            typeof value.result.digest !== "string" || !EFFECT_HASH.test(value.result.digest) ||
            (value.result.code !== undefined && (typeof value.result.code !== "string" || value.result.code.length > 40)) ||
            (value.result.reference !== undefined && (typeof value.result.reference !== "string" || value.result.reference.length > 100 || EFFECT_SECRETISH.test(value.result.reference))))
            throw new Error("workspace contains corrupt external-effect result metadata");
    }
    if ((value.state === "applied" || value.state === "failed") && value.result === undefined) {
        throw new Error("workspace contains a missing external-effect result");
    }
    if ((value.state === "intended" || value.state === "applying") && value.result !== undefined) {
        throw new Error("workspace contains an inconsistent external-effect result");
    }
}
export class WorkspaceStore {
    data;
    constructor() {
        this.data = emptyData();
        this.reloadFromDisk();
    }
    /** Reload durable workspace projections after an atomic restore. The
     * server-wide maintenance gate guarantees no scheduler or turn mutates the
     * old object graph while this method replaces it. */
    reloadFromDisk() {
        mkdirSync(DATA_DIR, { recursive: true });
        this.data = loadPersistentJson(WORKSPACE_FILE, {
            label: "Workspace, tasks, runs, routines and receipts", missing: emptyData, resetValue: emptyData(), maxBytes: 64 * 1024 * 1024,
            validate: (value) => {
                if (!value || typeof value !== "object" || Array.isArray(value))
                    throw new Error("invalid workspace schema");
                const disk = value;
                if (![disk.sections, disk.attachments, disk.tasks, disk.runs, disk.routines].every(Array.isArray))
                    throw new Error("invalid workspace schema");
                if (disk.tasks.length > 10_000 || disk.runs.length > 10_000 || disk.attachments.length > 10_000 || disk.routines.length > 10_000)
                    throw new Error("workspace schema is too large");
                for (const task of disk.tasks) {
                    if (!task || typeof task.id !== "string" || typeof task.botId !== "string" || typeof task.prompt !== "string")
                        throw new Error("invalid task schema");
                    if (task.budget !== undefined)
                        parseTaskBudget(task.budget);
                    if (task.evidenceRequirements !== undefined && (!Array.isArray(task.evidenceRequirements) || task.evidenceRequirements.some((entry) => !validRequirement(entry))))
                        throw new Error("invalid task evidence schema");
                }
                for (const run of disk.runs) {
                    if (!run || typeof run.id !== "string" || typeof run.taskId !== "string" || typeof run.botId !== "string" || !Array.isArray(run.steps) || !Array.isArray(run.artifacts))
                        throw new Error("invalid run schema");
                    const budgetTask = disk.tasks.find((task) => task.id === run.taskId);
                    if (Boolean(budgetTask?.budget) !== Boolean(run.budgetUsage))
                        throw new Error("inconsistent run budget schema");
                    if (run.budgetUsage !== undefined) {
                        if (!validTaskBudgetUsage(run.budgetUsage))
                            throw new Error("invalid run budget usage schema");
                        if (run.budgetUsage.activeSince !== undefined && run.status !== "running")
                            throw new Error("inactive run has an active budget interval");
                        if (run.budgetUsage.exhaustionReason && budgetTask?.budget?.[run.budgetUsage.exhaustionReason] === undefined) {
                            throw new Error("run exhausted an unconfigured budget metric");
                        }
                    }
                    if (run.checkpoint !== undefined && !validRunCheckpoint(run.checkpoint, run))
                        throw new Error("invalid checkpoint schema");
                    if (run.effects !== undefined) {
                        if (!Array.isArray(run.effects))
                            throw new Error("invalid effect receipt schema");
                        for (const effect of run.effects)
                            assertPersistedEffect(effect, run);
                    }
                }
                for (const routine of disk.routines) {
                    if (!routine || typeof routine.id !== "string" || typeof routine.botId !== "string" || typeof routine.name !== "string")
                        throw new Error("invalid routine schema");
                    validateSchedule(routine.schedule);
                }
                return disk;
            },
        });
        let recovered = false;
        // Evidence was added after the original work schema. Drop only malformed
        // optional evidence instead of letting corrupt rows influence verification.
        for (const task of this.data.tasks) {
            if (task.budget !== undefined) {
                try {
                    task.budget = parseTaskBudget(task.budget);
                    if (task.budgetDurationUsedMs !== undefined && (!Number.isSafeInteger(task.budgetDurationUsedMs) || task.budgetDurationUsedMs < 0))
                        throw new Error("invalid duration usage");
                }
                catch {
                    task.budget = { durationMs: 1_000 };
                    task.budgetDurationUsedMs = 1_000;
                    recovered = true;
                }
            }
            if (task.evidenceRequirements !== undefined) {
                const requirementIds = new Set();
                const requirements = Array.isArray(task.evidenceRequirements)
                    ? task.evidenceRequirements.filter((value) => {
                        if (!validRequirement(value) || requirementIds.has(value.id))
                            return false;
                        requirementIds.add(value.id);
                        return true;
                    }).slice(0, EVIDENCE_REQUIREMENT_MAX_COUNT)
                    : [];
                if (requirements.length !== (Array.isArray(task.evidenceRequirements) ? task.evidenceRequirements.length : -1))
                    recovered = true;
                task.evidenceRequirements = requirements;
            }
        }
        for (const run of this.data.runs) {
            if (run.evidence === undefined)
                continue;
            const requirementIds = new Set(this.data.tasks.find((task) => task.id === run.taskId)?.evidenceRequirements?.map((item) => item.id) ?? []);
            const evidenceIds = new Set();
            const evidence = Array.isArray(run.evidence) ? run.evidence.filter((value) => {
                if (!isRecord(value) || typeof value.id !== "string" || !/^[\w-]{1,100}$/.test(value.id) || evidenceIds.has(value.id))
                    return false;
                if (typeof value.requirementId !== "string" || !requirementIds.has(value.requirementId))
                    return false;
                if (!["claimed", "observed", "verified", "rejected"].includes(String(value.level)))
                    return false;
                if (!["user", "system", "verifier"].includes(String(value.source)))
                    return false;
                if (typeof value.label !== "string" || !value.label || value.label.length > EVIDENCE_LABEL_MAX_LENGTH)
                    return false;
                if (!Number.isSafeInteger(value.recordedAt) || Number(value.recordedAt) < 0)
                    return false;
                if (value.digest !== undefined && (typeof value.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.digest)))
                    return false;
                if (value.level === "verified" && (value.source !== "verifier" || !isRecord(value.verifier) ||
                    typeof value.verifier.id !== "string" || !value.verifier.id || value.verifier.id.length > EVIDENCE_LABEL_MAX_LENGTH ||
                    typeof value.verifier.version !== "string" || !value.verifier.version || value.verifier.version.length > EVIDENCE_LABEL_MAX_LENGTH ||
                    typeof value.digest !== "string" || value.reference === undefined))
                    return false;
                if (value.level === "observed" && (typeof value.digest !== "string" || value.reference === undefined))
                    return false;
                if (value.reference !== undefined) {
                    if (!isRecord(value.reference) || value.reference.runId !== run.id || !["step", "artifact"].includes(String(value.reference.kind)) || typeof value.reference.id !== "string")
                        return false;
                    const referenceId = value.reference.id;
                    const targets = value.reference.kind === "step" ? run.steps : run.artifacts;
                    if (!targets.some((target) => target.id === referenceId))
                        return false;
                }
                evidenceIds.add(value.id);
                return true;
            }).slice(0, EVIDENCE_MAX_PER_RUN) : [];
            if (evidence.length !== (Array.isArray(run.evidence) ? run.evidence.length : -1))
                recovered = true;
            run.evidence = evidence;
        }
        const effectById = new Map();
        for (const run of this.data.runs) {
            if (run.compaction !== undefined) {
                const value = run.compaction;
                if (!isRecord(value) || Object.keys(value).some((key) => !["policyVersion", "compacted", "originalMessages", "submittedMessages", "originalBytes", "submittedBytes", "omittedMessages", "estimatedSubmittedTokens", "selectedIdentityDigest"].includes(key)) ||
                    value.policyVersion !== 1 || typeof value.compacted !== "boolean" ||
                    ![value.originalMessages, value.submittedMessages, value.originalBytes, value.submittedBytes, value.omittedMessages, value.estimatedSubmittedTokens].every((number) => Number.isSafeInteger(number) && Number(number) >= 0) ||
                    Number(value.submittedMessages) > Number(value.originalMessages) ||
                    Number(value.omittedMessages) !== Number(value.originalMessages) - Number(value.submittedMessages) ||
                    typeof value.selectedIdentityDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.selectedIdentityDigest))
                    throw new Error("workspace contains corrupt context-compaction statistics");
            }
            if (run.effects === undefined)
                continue;
            if (!Array.isArray(run.effects) || run.effects.length > EFFECT_MAX_PER_RUN) {
                throw new Error("workspace contains an invalid external-effect collection");
            }
            for (const effect of run.effects) {
                assertPersistedEffect(effect, run);
                if (effectById.has(effect.id))
                    throw new Error("workspace contains duplicate external-effect identities");
                effectById.set(effect.id, effect);
            }
        }
        for (const effect of effectById.values()) {
            if (effect.attempt === 1 && effect.retryOf)
                throw new Error("workspace contains an invalid first external-effect attempt");
            if (effect.attempt > 1 && !effect.retryOf)
                throw new Error("workspace contains an unlinked external-effect retry");
            if (effect.retryOf) {
                const previous = effectById.get(effect.retryOf);
                if (!previous || previous.taskId !== effect.taskId || previous.botId !== effect.botId ||
                    previous.fingerprint !== effect.fingerprint || previous.attempt + 1 !== effect.attempt ||
                    previous.createdAt > effect.createdAt)
                    throw new Error("workspace contains an invalid external-effect retry relationship");
            }
        }
        const effectAttemptKeys = new Set();
        for (const effect of effectById.values()) {
            const key = `${effect.taskId}\0${effect.botId}\0${effect.fingerprint}\0${effect.attempt}`;
            if (effectAttemptKeys.has(key))
                throw new Error("workspace contains a duplicate external-effect attempt");
            effectAttemptKeys.add(key);
        }
        const now = Date.now();
        for (const run of this.data.runs) {
            if (run.checkpoint !== undefined && !validRunCheckpoint(run.checkpoint, run)) {
                delete run.checkpoint;
                run.resumeStatus = "unsafe";
                run.resumeUnsafeReason = "missing_transcript";
                recovered = true;
            }
            for (const effect of run.effects ?? []) {
                if (effect.state !== "applying" && effect.state !== "intended")
                    continue;
                const crossedBoundary = effect.state === "applying";
                effect.state = crossedBoundary ? "unknown" : "failed";
                effect.result = boundedEffectResult({ code: crossedBoundary ? "restart_unknown" : "abandoned_before_apply" }, false);
                effect.updatedAt = now;
                effect.audit = Array.isArray(effect.audit) ? effect.audit : [];
                appendEffectAudit(effect, effectAudit(crossedBoundary ? "restart_unknown" : "failed", now, crossedBoundary
                    ? "Cumea restarted after the external boundary was crossed; this effect will not be replayed automatically."
                    : "Cumea restarted before the external boundary was crossed; this attempt is safe to retry."));
                recovered = true;
            }
            if (run.status !== "running" && run.status !== "needs_attention")
                continue;
            const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
            if (task)
                this.settleBudgetDuration(run, task, now);
            const unsafeEffects = this.hasUnsafeEffects(run.id);
            if (run.checkpoint && run.checkpoint.phase !== "created" && !unsafeEffects) {
                run.checkpoint.status = "available";
                delete run.checkpoint.unsafeReason;
                run.checkpoint.updatedAt = now;
                run.resumeStatus = "available";
                delete run.resumeUnsafeReason;
            }
            else {
                const reason = unsafeEffects ? "unknown_effect" : "turn_not_accepted";
                if (run.checkpoint) {
                    run.checkpoint.status = "unsafe";
                    run.checkpoint.unsafeReason = reason;
                    run.checkpoint.updatedAt = now;
                }
                run.resumeStatus = "unsafe";
                run.resumeUnsafeReason = run.checkpoint ? reason : "missing_transcript";
            }
            run.status = "interrupted";
            run.error = "Cumea restarted before this run finished. Review its checkpoint before resuming.";
            run.completedAt = now;
            if (task) {
                task.status = "interrupted";
                task.updatedAt = now;
            }
            recovered = true;
        }
        for (const routine of this.data.routines) {
            if (routine.lastStatus === "running" || routine.lastStatus === "queued") {
                routine.lastStatus = "failed";
                routine.lastError = "Cumea restarted before this scheduled run was dispatched or finished.";
                recovered = true;
            }
            if (routine.enabled && !routine.nextRunAt) {
                routine.nextRunAt = nextOccurrence(routine.schedule, now);
                recovered = true;
            }
        }
        if (recovered)
            this.save();
    }
    save() {
        assertPersistenceWritable(WORKSPACE_FILE);
        this.data.tasks = this.data.tasks.slice(-MAX_HISTORY);
        const taskIds = new Set(this.data.tasks.map((task) => task.id));
        this.data.runs = this.data.runs.filter((run) => taskIds.has(run.taskId)).slice(-MAX_HISTORY);
        writeFileAtomic(WORKSPACE_FILE, JSON.stringify(this.data, null, 2));
    }
    snapshot() {
        return this.data;
    }
    createSection(name) {
        const clean = name.trim();
        if (!clean)
            throw Object.assign(new Error("section name required"), { status: 400 });
        if (this.data.sections.some((section) => section.name.toLowerCase() === clean.toLowerCase())) {
            throw Object.assign(new Error("a section with that name already exists"), { status: 409 });
        }
        const section = { id: newId(), name: clean.slice(0, 60), createdAt: Date.now() };
        this.data.sections.push(section);
        this.save();
        return section;
    }
    patchSection(id, name) {
        const section = this.data.sections.find((candidate) => candidate.id === id);
        if (!section)
            return null;
        const clean = name.trim();
        if (!clean)
            throw Object.assign(new Error("section name required"), { status: 400 });
        if (this.data.sections.some((candidate) => candidate.id !== id && candidate.name.toLowerCase() === clean.toLowerCase())) {
            throw Object.assign(new Error("a section with that name already exists"), { status: 409 });
        }
        section.name = clean.slice(0, 60);
        this.save();
        return section;
    }
    deleteSection(id) {
        const before = this.data.sections.length;
        this.data.sections = this.data.sections.filter((section) => section.id !== id);
        if (this.data.sections.length === before)
            return false;
        this.save();
        return true;
    }
    createAttachment(input) {
        this.assertAttachmentCapacity(input.botId, input.size);
        const attachment = { ...input, id: newId(), createdAt: Date.now() };
        this.data.attachments.push(attachment);
        this.save();
        return attachment;
    }
    attachmentUsage(botId) {
        const attachments = this.data.attachments.filter((attachment) => attachment.botId === botId);
        let bytes = 0;
        for (const attachment of attachments) {
            if (!Number.isSafeInteger(attachment.size) || attachment.size < 0) {
                throw Object.assign(new Error("attachment quota is unavailable"), { status: 500 });
            }
            bytes += attachment.size;
            if (!Number.isSafeInteger(bytes)) {
                throw Object.assign(new Error("attachment quota is unavailable"), { status: 500 });
            }
        }
        return { count: attachments.length, bytes };
    }
    assertAttachmentCapacity(botId, nextBytes) {
        if (!Number.isSafeInteger(nextBytes) || nextBytes < 0) {
            throw Object.assign(new Error("invalid attachment size"), { status: 400 });
        }
        const usage = this.attachmentUsage(botId);
        if (usage.count >= ATTACHMENT_MAX_COUNT_PER_BOT) {
            throw Object.assign(new Error("attachment count quota reached (100 per bot)"), { status: 429 });
        }
        if (usage.bytes + nextBytes > ATTACHMENT_MAX_BYTES_PER_BOT) {
            throw Object.assign(new Error("attachment storage quota exceeded (250 MB per bot)"), { status: 413 });
        }
    }
    attachment(id) {
        return this.data.attachments.find((candidate) => candidate.id === id) ?? null;
    }
    attachmentsFor(botId, ids) {
        const unique = [...new Set(ids)];
        const attachments = unique.map((id) => this.attachment(id));
        if (attachments.some((attachment) => !attachment || attachment.botId !== botId)) {
            throw Object.assign(new Error("one or more attachments are unavailable for this bot"), { status: 400 });
        }
        return attachments;
    }
    deleteAttachment(id) {
        const attachment = this.attachment(id);
        if (!attachment)
            return false;
        if (this.data.tasks.some((task) => task.attachmentIds.includes(id))) {
            throw Object.assign(new Error("attachment belongs to a task and is part of its audit trail"), { status: 409 });
        }
        try {
            unlinkSync(attachment.storedPath);
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                throw Object.assign(new Error("could not remove attachment file"), { status: 500, cause: error });
            }
        }
        // Only forget the record after the file is absent. A failed unlink keeps
        // the workspace reference intact so a retry can finish the rollback.
        this.data.attachments = this.data.attachments.filter((candidate) => candidate.id !== id);
        this.save();
        return true;
    }
    /** Remove every durable workspace record owned by a deleted bot.
     *
     * Routines must not survive their executor: leaving one enabled would keep
     * the scheduler waking up for a bot that can never run it. Tasks and runs
     * are deleted with the same ownership boundary so the workspace cannot
     * retain dangling bot/routine references after the conversation is gone.
     */
    removeBotData(botId) {
        const files = stageFilesForDeletion(this.botDeletionFiles(botId));
        let transaction = null;
        try {
            transaction = this.removeBotDataTransaction(botId);
        }
        catch (error) {
            const rollbackErrors = [];
            try {
                transaction?.rollback();
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                files.rollback();
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            if (rollbackErrors.length) {
                throw Object.assign(new Error("bot workspace deletion failed and could not be fully rolled back"), {
                    status: 500,
                    cause: new AggregateError([error, ...rollbackErrors]),
                });
            }
            throw error;
        }
        // Records have committed. A purge failure leaves only private quarantine
        // garbage for later maintenance; rolling records back after even one file
        // was removed would instead create dangling paths and data loss.
        purgeCommittedFileDeletions([files], () => console.error("could not purge committed bot workspace quarantine"));
        return transaction.removed;
    }
    botDeletionFiles(botId) {
        return this.data.attachments
            .filter((attachment) => attachment.botId === botId)
            .map((attachment) => ({ path: attachment.storedPath, label: `attachment ${attachment.name}` }));
    }
    /**
     * Commit bot-owned workspace cleanup while retaining a one-shot rollback
     * for the outer, cross-store delete transaction.
     */
    removeBotDataTransaction(botId) {
        if (this.data.runs.some((run) => run.botId === botId && (run.effects ?? []).some((effect) => effect.state === "intended" || effect.state === "applying"))) {
            throw Object.assign(new Error("the bot has an external effect crossing its boundary"), { status: 409 });
        }
        const removedAttachments = this.data.attachments.filter((attachment) => attachment.botId === botId);
        const removedRoutineIds = new Set(this.data.routines.filter((routine) => routine.botId === botId).map((routine) => routine.id));
        const removedTaskIds = new Set(this.data.tasks
            .filter((task) => task.botId === botId || (task.routineId && removedRoutineIds.has(task.routineId)))
            .map((task) => task.id));
        const removedRuns = this.data.runs.filter((run) => run.botId === botId
            || removedTaskIds.has(run.taskId)
            || Boolean(run.routineId && removedRoutineIds.has(run.routineId)));
        const previous = {
            attachments: this.data.attachments,
            routines: this.data.routines,
            tasks: this.data.tasks,
            runs: this.data.runs,
        };
        this.data.attachments = previous.attachments.filter((attachment) => attachment.botId !== botId);
        this.data.routines = previous.routines.filter((routine) => !removedRoutineIds.has(routine.id));
        this.data.tasks = previous.tasks.filter((task) => !removedTaskIds.has(task.id));
        const removedRunIds = new Set(removedRuns.map((run) => run.id));
        this.data.runs = previous.runs.filter((run) => !removedRunIds.has(run.id));
        const removed = {
            attachments: removedAttachments.length,
            tasks: removedTaskIds.size,
            runs: removedRuns.length,
            routines: removedRoutineIds.size,
        };
        const changed = Object.values(removed).some((count) => count > 0);
        if (changed) {
            try {
                this.save();
            }
            catch (error) {
                // Atomic file persistence keeps the previous disk snapshot intact;
                // restore memory too. Missing attachment bytes are tolerated on retry.
                Object.assign(this.data, previous);
                throw error;
            }
        }
        let rolledBack = false;
        return {
            removed,
            rollback: () => {
                if (rolledBack || !changed)
                    return;
                Object.assign(this.data, previous);
                try {
                    this.save();
                    rolledBack = true;
                }
                catch (error) {
                    // Keep the retry records visible in the live store even when the
                    // durable rollback itself is blocked.
                    throw Object.assign(new Error("could not restore bot workspace records after deletion failed"), {
                        status: 500,
                        cause: error,
                    });
                }
            },
        };
    }
    createTask(input) {
        const now = Date.now();
        const budget = parseTaskBudget(input.budget);
        const task = {
            id: newId(),
            botId: input.botId,
            title: (input.title?.trim() || taskTitle(input.prompt)).slice(0, 100),
            prompt: input.prompt,
            source: input.source ?? "message",
            ...(input.sourceBotId ? { sourceBotId: input.sourceBotId } : {}),
            ...(input.routineId ? { routineId: input.routineId } : {}),
            ...(input.scheduledFor !== undefined ? { scheduledFor: input.scheduledFor } : {}),
            status: "queued",
            attachmentIds: input.attachmentIds ?? [],
            ...(input.messageId ? { messageId: input.messageId } : {}),
            ...(budget ? { budget } : {}),
            createdAt: now,
            updatedAt: now,
        };
        this.data.tasks.push(task);
        this.save();
        return task;
    }
    task(id) {
        return this.data.tasks.find((candidate) => candidate.id === id) ?? null;
    }
    queuedMessageTasks(botId) {
        return this.data.tasks
            .filter((task) => task.botId === botId && task.source === "message" && task.status === "queued")
            .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    }
    bindQueuedMessage(id, messageId) {
        const task = this.task(id);
        if (!task || task.source !== "message" || task.status !== "queued")
            return null;
        task.messageId = messageId;
        task.updatedAt = Date.now();
        this.save();
        return task;
    }
    settleQueuedTask(id, status) {
        const task = this.task(id);
        if (!task || task.source !== "message" || task.status !== "queued")
            return null;
        task.status = status;
        task.updatedAt = Date.now();
        this.save();
        return task;
    }
    createRun(taskId, options = {}) {
        const task = this.data.tasks.find((candidate) => candidate.id === taskId);
        if (!task)
            throw new Error("no such task");
        const run = {
            id: newId(),
            taskId,
            botId: task.botId,
            ...(task.routineId ? { routineId: task.routineId } : {}),
            ...(options.resumeOfRunId ? { resumeOfRunId: options.resumeOfRunId } : {}),
            ...(options.resumedFromCheckpointId ? { resumedFromCheckpointId: options.resumedFromCheckpointId } : {}),
            attempt: options.resumeOfRunId ? (this.run(options.resumeOfRunId)?.attempt ?? 1) + 1 : 1,
            status: "running",
            steps: [],
            artifacts: (options.omitAttachmentArtifacts ? [] : task.attachmentIds).map((attachmentId) => {
                const attachment = this.attachment(attachmentId);
                return {
                    id: newId(),
                    kind: "attachment",
                    label: attachment?.name ?? "Attachment",
                    attachmentId,
                    mime: attachment?.mime,
                    createdAt: Date.now(),
                };
            }),
            startedAt: Date.now(),
        };
        if (task.budget) {
            run.budgetUsage = {
                startedAt: run.startedAt,
                activeSince: run.startedAt,
                durationUsedMs: 0,
                toolCalls: 0,
                computerActions: 0,
                delegations: 0,
            };
        }
        task.status = "running";
        task.updatedAt = Date.now();
        task.latestRunId = run.id;
        this.data.runs.push(run);
        if (task.routineId) {
            const routine = this.data.routines.find((candidate) => candidate.id === task.routineId);
            if (routine) {
                routine.lastRunAt = run.startedAt;
                routine.lastStatus = "running";
                routine.lastError = undefined;
            }
        }
        if (!options.deferSave)
            this.save();
        return run;
    }
    /** Atomically consumes one checkpoint and creates its linked attempt. */
    createResumeRun(runId) {
        const previous = this.run(runId);
        const task = previous ? this.task(previous.taskId) : null;
        const checkpoint = previous?.checkpoint;
        if (!previous || !task || !checkpoint)
            throw Object.assign(new Error("no resumable checkpoint"), { status: 404 });
        if (previous.status !== "interrupted" || task.status !== "interrupted" || task.latestRunId !== previous.id) {
            throw Object.assign(new Error("checkpoint is no longer the latest interrupted attempt"), { status: 409 });
        }
        if (checkpoint.status !== "available" || checkpoint.resumedByRunId || this.hasUnsafeEffects(previous.id)) {
            throw Object.assign(new Error("checkpoint is not safe to resume"), { status: 409 });
        }
        const oldTask = { status: task.status, updatedAt: task.updatedAt, latestRunId: task.latestRunId };
        const oldCheckpoint = { ...checkpoint };
        const oldResumeStatus = previous.resumeStatus;
        const oldResumeUnsafeReason = previous.resumeUnsafeReason;
        const oldRunsLength = this.data.runs.length;
        const routine = task.routineId ? this.data.routines.find((candidate) => candidate.id === task.routineId) : undefined;
        const oldRoutine = routine ? { lastRunAt: routine.lastRunAt, lastStatus: routine.lastStatus, lastError: routine.lastError } : undefined;
        try {
            const next = this.createRun(task.id, {
                resumeOfRunId: previous.id,
                resumedFromCheckpointId: checkpoint.id,
                omitAttachmentArtifacts: true,
                deferSave: true,
            });
            checkpoint.status = "consumed";
            checkpoint.resumedByRunId = next.id;
            checkpoint.updatedAt = Date.now();
            previous.resumeStatus = "resumed";
            delete previous.resumeUnsafeReason;
            this.save();
            return next;
        }
        catch (error) {
            this.data.runs.splice(oldRunsLength);
            task.status = oldTask.status;
            task.updatedAt = oldTask.updatedAt;
            task.latestRunId = oldTask.latestRunId;
            previous.checkpoint = oldCheckpoint;
            previous.resumeStatus = oldResumeStatus;
            previous.resumeUnsafeReason = oldResumeUnsafeReason;
            if (routine && oldRoutine) {
                routine.lastRunAt = oldRoutine.lastRunAt;
                routine.lastStatus = oldRoutine.lastStatus;
                routine.lastError = oldRoutine.lastError;
            }
            throw error;
        }
    }
    run(id) {
        return this.data.runs.find((candidate) => candidate.id === id) ?? null;
    }
    recordCompaction(runId, stats) {
        const run = this.run(runId);
        if (!run)
            throw Object.assign(new Error("no such run"), { status: 404 });
        run.compaction = { ...stats };
        this.save();
    }
    budgetTotals(taskId) {
        const totals = { toolCalls: 0, computerActions: 0, delegations: 0 };
        for (const run of this.data.runs.filter((candidate) => candidate.taskId === taskId)) {
            const usage = run.budgetUsage;
            if (!usage)
                continue;
            totals.toolCalls += usage.toolCalls;
            totals.computerActions += usage.computerActions;
            totals.delegations += usage.delegations;
            if (usage.tokens !== undefined)
                totals.tokens = (totals.tokens ?? 0) + usage.tokens;
        }
        return totals;
    }
    chargeBudget(runId, metric, amount = 1) {
        const run = this.run(runId);
        const task = run ? this.task(run.taskId) : null;
        if (!run || !task?.budget || !run.budgetUsage)
            return null;
        if (!Number.isSafeInteger(amount) || amount < 0)
            throw new Error("invalid budget usage increment");
        const limit = task.budget[metric];
        if (limit === undefined)
            return null;
        if (metric === "tokens")
            run.budgetUsage.tokens = (run.budgetUsage.tokens ?? 0) + amount;
        else
            run.budgetUsage[metric] += amount;
        const total = this.budgetTotals(task.id)[metric] ?? 0;
        if (total >= limit && !run.budgetUsage.exhaustionReason) {
            run.budgetUsage.exhaustedAt = Date.now();
            run.budgetUsage.exhaustionReason = metric;
        }
        task.updatedAt = Date.now();
        this.save();
        return run.budgetUsage.exhaustionReason ?? null;
    }
    observeTokenUsage(runId, providerInstanceId, model, input, output) {
        const run = this.run(runId);
        if (!run?.budgetUsage || !providerInstanceId || !model || !Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0)
            return null;
        const priorForProvider = [...this.data.runs]
            .reverse()
            .find((candidate) => candidate.id !== run.id && candidate.botId === run.botId && candidate.budgetUsage?.tokenLatest?.providerInstanceId === providerInstanceId && candidate.budgetUsage?.tokenLatest?.model === model)
            ?.budgetUsage?.tokenLatest;
        const previous = run.budgetUsage.tokenBaseline?.providerInstanceId === providerInstanceId && run.budgetUsage.tokenBaseline.model === model
            ? run.budgetUsage.tokenBaseline
            : priorForProvider;
        run.budgetUsage.tokenBaseline = { providerInstanceId, model, input, output };
        run.budgetUsage.tokenLatest = { providerInstanceId, model, input, output };
        if (!previous) {
            this.save();
            return null;
        }
        if (input < previous.input || output < previous.output) {
            this.save();
            return null;
        }
        const delta = (input - previous.input) + (output - previous.output);
        return delta ? this.chargeBudget(runId, "tokens", delta) : null;
    }
    checkDurationBudget(runId, now = Date.now()) {
        const run = this.run(runId);
        const task = run ? this.task(run.taskId) : null;
        if (!run || !task?.budget?.durationMs || !run.budgetUsage || run.budgetUsage.exhaustionReason)
            return run?.budgetUsage?.exhaustionReason ?? null;
        const current = run.budgetUsage.activeSince === undefined ? 0 : Math.max(0, now - run.budgetUsage.activeSince);
        if ((task.budgetDurationUsedMs ?? 0) + current < task.budget.durationMs)
            return null;
        run.budgetUsage.exhaustedAt = now;
        run.budgetUsage.exhaustionReason = "durationMs";
        task.updatedAt = now;
        this.save();
        return "durationMs";
    }
    pauseBudgetDuration(runId, now = Date.now()) {
        const run = this.run(runId);
        const task = run ? this.task(run.taskId) : null;
        if (!run || !task)
            return;
        this.settleBudgetDuration(run, task, now);
        task.updatedAt = now;
        this.save();
    }
    resumeBudgetDuration(runId, now = Date.now()) {
        const run = this.run(runId);
        const task = run ? this.task(run.taskId) : null;
        if (!run?.budgetUsage || !task?.budget?.durationMs || run.budgetUsage.exhaustionReason || run.budgetUsage.activeSince !== undefined)
            return false;
        run.budgetUsage.activeSince = now;
        task.updatedAt = now;
        this.save();
        return true;
    }
    markBudgetExhausted(runId, reason) {
        const run = this.run(runId);
        const task = run ? this.task(run.taskId) : null;
        if (!run || !task || !run.budgetUsage)
            return false;
        if (["completed", "failed", "cancelled"].includes(run.status))
            return false;
        const now = Date.now();
        run.budgetUsage.exhaustionReason ??= reason;
        run.budgetUsage.exhaustedAt ??= now;
        this.settleBudgetDuration(run, task, now);
        run.status = "needs_attention";
        run.error = `Task budget exhausted: ${run.budgetUsage.exhaustionReason}.`;
        task.status = "needs_attention";
        task.updatedAt = now;
        this.save();
        return true;
    }
    settleBudgetDuration(run, task, now) {
        const usage = run.budgetUsage;
        if (!usage || usage.activeSince === undefined)
            return;
        const elapsed = Math.max(0, now - usage.activeSince);
        usage.durationUsedMs += elapsed;
        task.budgetDurationUsedMs = (task.budgetDurationUsedMs ?? 0) + elapsed;
        delete usage.activeSince;
    }
    bindTaskMessage(taskId, messageId) {
        const task = this.task(taskId);
        if (!task || task.status !== "queued" || task.messageId && task.messageId !== messageId)
            return null;
        task.messageId = messageId;
        task.updatedAt = Date.now();
        this.save();
        return task;
    }
    initializeCheckpoint(runId, input) {
        const run = this.run(runId);
        if (!run)
            throw Object.assign(new Error("no such run"), { status: 404 });
        const checkpoint = createRunCheckpoint({
            runId: run.id,
            taskId: run.taskId,
            botId: run.botId,
            ...input,
        });
        run.checkpoint = checkpoint;
        run.resumeStatus = "unsafe";
        run.resumeUnsafeReason = "turn_not_accepted";
        this.save();
        return checkpoint;
    }
    updateCheckpoint(runId, input) {
        const run = this.run(runId);
        const checkpoint = run?.checkpoint;
        if (!run || !checkpoint || checkpoint.status === "consumed")
            return null;
        checkpoint.phase = input.phase;
        checkpoint.activeLeafId = input.activeLeafId;
        checkpoint.provider = { instanceId: input.instanceId, model: input.model };
        const digest = checkpointCursorDigest(input.cursor);
        checkpoint.cursor = digest ? { instanceId: input.instanceId, digest } : undefined;
        checkpoint.sequence += 1;
        checkpoint.updatedAt = Date.now();
        if (this.hasUnsafeEffects(run.id)) {
            checkpoint.status = "unsafe";
            checkpoint.unsafeReason = "unknown_effect";
            run.resumeStatus = "unsafe";
            run.resumeUnsafeReason = "unknown_effect";
        }
        else {
            checkpoint.status = "available";
            delete checkpoint.unsafeReason;
            run.resumeStatus = "available";
            delete run.resumeUnsafeReason;
        }
        this.save();
        return checkpoint;
    }
    consumeCheckpoint(runId, resumedByRunId) {
        const run = this.run(runId);
        const checkpoint = run?.checkpoint;
        if (!run || !checkpoint || checkpoint.status !== "available")
            return null;
        checkpoint.status = "consumed";
        checkpoint.resumedByRunId = resumedByRunId;
        checkpoint.updatedAt = Date.now();
        run.resumeStatus = "resumed";
        delete run.resumeUnsafeReason;
        this.save();
        return checkpoint;
    }
    beginExternalEffect(runId, input) {
        const run = this.run(runId);
        const task = run ? this.task(run.taskId) : null;
        if (!run || !task || task.botId !== run.botId) {
            throw Object.assign(new Error("effect owner is unavailable"), { status: 404 });
        }
        if (run.status !== "running" && run.status !== "needs_attention") {
            throw Object.assign(new Error("effects can only start inside an active run"), { status: 409 });
        }
        if (input.stepId && !run.steps.some((step) => step.id === input.stepId)) {
            throw Object.assign(new Error("effect step does not belong to this run"), { status: 400 });
        }
        if (input.itemId && !/^[A-Za-z0-9._:-]{1,100}$/.test(input.itemId)) {
            throw Object.assign(new Error("effect item identity is invalid"), { status: 400 });
        }
        const descriptor = normalizeEffectDescriptor(input);
        const requestHash = effectRequestHash(input.request ?? null);
        const fingerprint = effectBaseFingerprint({
            taskId: task.id,
            botId: run.botId,
            descriptor,
            requestHash,
            destinationIdempotencyKey: input.destinationIdempotencyKey,
        });
        const effects = run.effects ?? (run.effects = []);
        const matching = this.data.runs
            .filter((candidate) => candidate.taskId === task.id && candidate.botId === task.botId)
            .flatMap((candidate) => candidate.effects ?? [])
            .filter((candidate) => candidate.fingerprint === fingerprint);
        const applied = [...matching].reverse().find((candidate) => candidate.state === "applied");
        if (applied) {
            const now = Date.now();
            appendEffectAudit(applied, effectAudit("duplicate", now, "Duplicate request reconciled to an applied receipt."));
            applied.updatedAt = now;
            this.save();
            return { kind: "duplicate_applied", effect: applied };
        }
        const uncertain = [...matching].reverse().find((candidate) => candidate.state === "unknown" || candidate.state === "applying" || candidate.state === "intended");
        if (uncertain) {
            const now = Date.now();
            appendEffectAudit(uncertain, effectAudit("duplicate", now, "Duplicate request blocked because its outcome is not safe to replay."));
            uncertain.updatedAt = now;
            this.save();
            return { kind: "blocked", effect: uncertain };
        }
        if (effects.length >= EFFECT_MAX_PER_RUN) {
            throw Object.assign(new Error("this run has too many external-effect receipts"), { status: 409 });
        }
        const previous = [...matching].reverse().find((candidate) => candidate.state === "failed");
        const attempt = matching.reduce((maximum, candidate) => Math.max(maximum, candidate.attempt), 0) + 1;
        const now = Date.now();
        const effect = {
            id: `effect-${newId()}`,
            runId: run.id,
            taskId: task.id,
            botId: run.botId,
            ...(input.stepId ? { stepId: input.stepId } : {}),
            ...(input.itemId ? { itemId: input.itemId } : {}),
            origin: "controlled",
            descriptor,
            requestHash,
            fingerprint,
            idempotencyKey: attemptIdempotencyKey(fingerprint, attempt, input.destinationIdempotencyKey),
            attempt,
            ...(previous ? { retryOf: previous.id } : {}),
            state: "intended",
            audit: [effectAudit("intended", now, previous ? "Explicit retry created a new attempt." : undefined)],
            createdAt: now,
            updatedAt: now,
        };
        effects.push(effect);
        this.save();
        return { kind: "ready", effect };
    }
    markExternalEffectApplying(effectId) {
        const effect = this.externalEffect(effectId);
        if (!effect)
            throw Object.assign(new Error("no such external effect"), { status: 404 });
        if (effect.state !== "intended")
            throw Object.assign(new Error("external effect is not ready to apply"), { status: 409 });
        const now = Date.now();
        effect.state = "applying";
        effect.updatedAt = now;
        appendEffectAudit(effect, effectAudit("applying", now, "Durable marker written before crossing the external boundary."));
        this.save();
        return effect;
    }
    settleKnownExternalEffect(effectId, state, result) {
        const effect = this.externalEffect(effectId);
        if (!effect)
            throw Object.assign(new Error("no such external effect"), { status: 404 });
        if (effect.state !== "applying")
            throw Object.assign(new Error("external effect is not being applied"), { status: 409 });
        const previous = { state: effect.state, result: effect.result, updatedAt: effect.updatedAt, audit: [...effect.audit] };
        const now = Date.now();
        effect.state = state;
        effect.result = boundedEffectResult(result, state === "applied");
        effect.updatedAt = now;
        appendEffectAudit(effect, effectAudit(state, now));
        try {
            this.save();
        }
        catch (error) {
            effect.state = previous.state;
            effect.result = previous.result;
            effect.updatedAt = previous.updatedAt;
            effect.audit = previous.audit;
            throw error;
        }
        return effect;
    }
    settleExternalEffectApplied(effectId, result) {
        return this.settleKnownExternalEffect(effectId, "applied", result);
    }
    /** Only for an adapter-confirmed rejection before mutation. Timeouts and
     * disconnects must use `markExternalEffectUnknown` instead. */
    confirmExternalEffectNotApplied(effectId, code = "not_applied") {
        return this.settleKnownExternalEffect(effectId, "failed", { code });
    }
    markExternalEffectUnknown(effectId, code = "ambiguous_failure") {
        const effect = this.externalEffect(effectId);
        if (!effect)
            throw Object.assign(new Error("no such external effect"), { status: 404 });
        if (effect.state !== "applying")
            throw Object.assign(new Error("external effect is not being applied"), { status: 409 });
        const safeCode = /^[A-Za-z0-9._:-]{1,40}$/.test(code) ? code : "ambiguous_failure";
        const now = Date.now();
        effect.state = "unknown";
        effect.result = boundedEffectResult({ code: safeCode }, false);
        effect.updatedAt = now;
        appendEffectAudit(effect, effectAudit("ambiguous_unknown", now, "The destination outcome was not conclusive; automatic replay is blocked."));
        // If this write fails, the prior durable state remains `applying`; restart
        // recovery still converts it to `unknown`. Keep memory unknown as well.
        this.save();
        return effect;
    }
    /** Adapter hook that durably brackets a known external boundary. */
    async executeExternalEffect(runId, input, operation) {
        const begun = this.beginExternalEffect(runId, input);
        if (begun.kind === "duplicate_applied")
            return { effect: begun.effect, duplicate: true };
        if (begun.kind === "blocked") {
            throw Object.assign(new Error("external effect outcome is unknown; resolve it locally before retrying"), { status: 409, effectId: begun.effect.id });
        }
        this.markExternalEffectApplying(begun.effect.id);
        let value;
        try {
            value = await operation();
        }
        catch (error) {
            try {
                if (isExternalEffectNotApplied(error)) {
                    this.confirmExternalEffectNotApplied(begun.effect.id, error.effectCode);
                }
                else {
                    this.markExternalEffectUnknown(begun.effect.id, error instanceof Error ? error.name : "ambiguous_failure");
                }
            }
            catch (receiptError) {
                throw new AggregateError([error, receiptError], "The external effect outcome and its durable receipt require local review.");
            }
            throw error;
        }
        try {
            return { effect: this.settleExternalEffectApplied(begun.effect.id, value), duplicate: false, value };
        }
        catch (receiptError) {
            try {
                this.markExternalEffectUnknown(begun.effect.id, "receipt_persistence_failure");
            }
            catch (unknownError) {
                throw new AggregateError([receiptError, unknownError], "The destination acknowledged the effect, but its durable receipt requires local review.");
            }
            throw Object.assign(new Error("The destination acknowledged the effect, but its durable receipt requires local review."), {
                cause: receiptError,
                status: 500,
            });
        }
    }
    observeOpaqueExternalEffect(runId, input) {
        const run = this.run(runId);
        const task = run ? this.task(run.taskId) : null;
        if (!run || !task || run.botId !== task.botId)
            throw Object.assign(new Error("effect owner is unavailable"), { status: 404 });
        const effects = run.effects ?? (run.effects = []);
        if (input.stepId && !run.steps.some((step) => step.id === input.stepId)) {
            throw Object.assign(new Error("effect step does not belong to this run"), { status: 400 });
        }
        if (effects.length >= EFFECT_MAX_PER_RUN)
            throw Object.assign(new Error("this run has too many external-effect receipts"), { status: 409 });
        const descriptor = normalizeEffectDescriptor(input.descriptor);
        const requestHash = effectRequestHash({ providerItemId: input.itemId ?? "unidentified" });
        const fingerprint = effectBaseFingerprint({ taskId: task.id, botId: run.botId, descriptor, requestHash });
        const existing = effects.find((candidate) => candidate.origin === "provider_observation" && candidate.fingerprint === fingerprint);
        if (existing)
            return existing;
        const itemId = input.itemId && /^[A-Za-z0-9._:-]{1,100}$/.test(input.itemId) ? input.itemId : undefined;
        const now = Date.now();
        const effect = {
            id: `effect-${newId()}`,
            runId: run.id,
            taskId: task.id,
            botId: run.botId,
            ...(input.stepId ? { stepId: input.stepId } : {}),
            ...(itemId ? { itemId } : {}),
            origin: "provider_observation",
            descriptor,
            requestHash,
            fingerprint,
            idempotencyKey: attemptIdempotencyKey(fingerprint, 1),
            attempt: 1,
            state: "unknown",
            result: boundedEffectResult({ code: "opaque_provider_observation" }, false),
            audit: [effectAudit("observed_unknown", now, "Opaque provider write observed after its boundary; no replay is assumed safe.")],
            createdAt: now,
            updatedAt: now,
        };
        effects.push(effect);
        this.save();
        return effect;
    }
    externalEffect(effectId) {
        for (const run of this.data.runs) {
            const effect = (run.effects ?? []).find((candidate) => candidate.id === effectId);
            if (effect)
                return effect;
        }
        return null;
    }
    hasUnsafeEffects(runId) {
        return Boolean(this.run(runId)?.effects?.some((effect) => effect.state === "applying" || effect.state === "unknown"));
    }
    resolveExternalEffect(effectId, resolution, note) {
        const effect = this.externalEffect(effectId);
        if (!effect)
            throw Object.assign(new Error("no such external effect"), { status: 404 });
        if (effect.state !== "unknown")
            throw Object.assign(new Error("only an unknown external effect can be resolved"), { status: 409 });
        if (typeof note !== "string" || !note.trim() || note.trim().length > 160) {
            throw Object.assign(new Error("a short resolution note is required"), { status: 400 });
        }
        const cleanNote = note.replace(/\s+/g, " ").trim();
        if (EFFECT_SECRETISH.test(cleanNote)) {
            throw Object.assign(new Error("resolution note must not contain secrets or URLs"), { status: 400 });
        }
        const now = Date.now();
        effect.state = resolution;
        effect.result = boundedEffectResult({ code: "user_resolution" }, resolution === "applied");
        effect.updatedAt = now;
        appendEffectAudit(effect, effectAudit("user_resolved", now, cleanNote));
        const ownerRun = this.run(effect.runId);
        if (ownerRun?.checkpoint && ownerRun.status === "interrupted" && !this.hasUnsafeEffects(ownerRun.id)) {
            ownerRun.checkpoint.status = "available";
            delete ownerRun.checkpoint.unsafeReason;
            ownerRun.checkpoint.updatedAt = now;
            ownerRun.resumeStatus = "available";
            delete ownerRun.resumeUnsafeReason;
        }
        this.save();
        return effect;
    }
    verificationStatus(taskId) {
        const task = this.task(taskId);
        if (!task)
            throw Object.assign(new Error("no such task"), { status: 404 });
        const requirements = task.evidenceRequirements ?? [];
        if (!requirements.length)
            return "not_required";
        const evidence = this.data.runs
            .filter((run) => run.taskId === task.id)
            .flatMap((run) => run.evidence ?? []);
        if (requirements.some((requirement) => evidence.some((record) => record.requirementId === requirement.id && record.level === "rejected")))
            return "failed";
        if (requirements.every((requirement) => evidence.some((record) => record.requirementId === requirement.id && record.level === "verified")))
            return "verified";
        if (evidence.some((record) => record.level === "observed" || record.level === "verified"))
            return "observed";
        if (evidence.some((record) => record.level === "claimed"))
            return "claimed";
        return "pending";
    }
    addEvidenceRequirement(taskId, value) {
        const task = this.task(taskId);
        if (!task)
            throw Object.assign(new Error("no such task"), { status: 404 });
        const requirements = task.evidenceRequirements ?? (task.evidenceRequirements = []);
        if (requirements.length >= EVIDENCE_REQUIREMENT_MAX_COUNT) {
            throw Object.assign(new Error("too many evidence requirements"), { status: 409 });
        }
        const label = boundedEvidenceLabel(value);
        if (requirements.some((candidate) => candidate.label.toLocaleLowerCase() === label.toLocaleLowerCase())) {
            throw Object.assign(new Error("that evidence requirement already exists"), { status: 409 });
        }
        const requirement = { id: newId(), label, createdAt: Date.now() };
        requirements.push(requirement);
        task.updatedAt = Date.now();
        this.save();
        return requirement;
    }
    removeEvidenceRequirement(taskId, requirementId) {
        const task = this.task(taskId);
        if (!task)
            return false;
        const requirements = task.evidenceRequirements ?? [];
        const index = requirements.findIndex((candidate) => candidate.id === requirementId);
        if (index < 0)
            return false;
        requirements.splice(index, 1);
        for (const run of this.data.runs.filter((candidate) => candidate.taskId === taskId)) {
            if (run.evidence)
                run.evidence = run.evidence.filter((record) => record.requirementId !== requirementId);
        }
        task.updatedAt = Date.now();
        this.save();
        return true;
    }
    /** Records a bounded claim without promoting it to an observation. This is
     * an integration point only; assistant response text is never ingested here
     * automatically. */
    recordEvidenceClaim(input) {
        const task = this.task(input.taskId);
        const run = this.run(input.runId);
        if (!task || !run || run.taskId !== task.id || run.botId !== task.botId) {
            throw Object.assign(new Error("evidence claim does not belong to this task"), { status: 404 });
        }
        const requirement = (task.evidenceRequirements ?? []).find((candidate) => candidate.id === input.requirementId);
        if (!requirement)
            throw Object.assign(new Error("no such evidence requirement"), { status: 404 });
        const label = boundedEvidenceLabel(input.label);
        const evidence = run.evidence ?? (run.evidence = []);
        const existing = evidence.find((record) => record.requirementId === requirement.id && record.level === "claimed" && record.label === label);
        if (existing)
            return existing;
        if (evidence.length >= EVIDENCE_MAX_PER_RUN)
            throw Object.assign(new Error("too much evidence for this run"), { status: 409 });
        const record = {
            id: newId(),
            requirementId: requirement.id,
            level: "claimed",
            source: "system",
            label,
            recordedAt: Date.now(),
        };
        evidence.push(record);
        task.updatedAt = Date.now();
        this.save();
        return record;
    }
    recordEvidenceWithLevel(input) {
        const task = this.task(input.taskId);
        const run = this.run(input.runId);
        if (!task || !run || run.taskId !== task.id || run.botId !== task.botId) {
            throw Object.assign(new Error("evidence reference does not belong to this task"), { status: 404 });
        }
        const requirement = (task.evidenceRequirements ?? []).find((candidate) => candidate.id === input.requirementId);
        if (!requirement)
            throw Object.assign(new Error("no such evidence requirement"), { status: 404 });
        const canonical = input.reference.kind === "step"
            ? run.steps.find((candidate) => candidate.id === input.reference.id)
            : run.artifacts.find((candidate) => candidate.id === input.reference.id);
        if (!canonical)
            throw Object.assign(new Error("no such canonical evidence reference"), { status: 404 });
        const label = input.reference.kind === "step"
            ? run.steps.find((candidate) => candidate.id === input.reference.id).title
            : run.artifacts.find((candidate) => candidate.id === input.reference.id).label;
        const evidence = run.evidence ?? (run.evidence = []);
        const digest = evidenceDigest({ kind: input.reference.kind, runId: run.id, canonical });
        const level = input.verifier ? "verified" : "observed";
        const existing = evidence.find((record) => record.requirementId === requirement.id && record.level === level && record.digest === digest &&
            record.verifier?.id === input.verifier?.id && record.verifier?.version === input.verifier?.version);
        if (existing)
            return existing;
        if (evidence.length >= EVIDENCE_MAX_PER_RUN)
            throw Object.assign(new Error("too much evidence for this run"), { status: 409 });
        const record = {
            id: newId(),
            requirementId: requirement.id,
            level,
            source: input.verifier ? "verifier" : "user",
            label,
            reference: { ...input.reference, runId: run.id },
            digest,
            ...(input.verifier ? { verifier: input.verifier } : {}),
            recordedAt: Date.now(),
        };
        evidence.push(record);
        task.updatedAt = Date.now();
        this.save();
        return record;
    }
    recordEvidence(input) {
        return this.recordEvidenceWithLevel(input);
    }
    /** Trusted verifier integration point. It is intentionally not exposed over
     * HTTP; provider prose and ordinary tool completion can never call it. */
    recordVerifiedEvidence(input) {
        const verifierId = boundedEvidenceLabel(input.verifier.id);
        const verifierVersion = boundedEvidenceLabel(input.verifier.version);
        return this.recordEvidenceWithLevel({
            ...input,
            verifier: { id: verifierId, version: verifierVersion },
        });
    }
    bindTurn(runId, turnId) {
        const run = this.run(runId);
        if (!run)
            return;
        run.turnId = turnId;
        this.save();
    }
    addStep(runId, input) {
        const run = this.run(runId);
        if (!run)
            return null;
        const step = {
            id: newId(),
            ...(input.itemId ? { itemId: input.itemId } : {}),
            kind: input.kind,
            title: input.title,
            status: input.status ?? "running",
            startedAt: Date.now(),
        };
        run.steps.push(step);
        this.save();
        return step;
    }
    completeStep(runId, itemId, status) {
        const run = this.run(runId);
        if (!run)
            return null;
        const step = [...run.steps].reverse().find((candidate) => itemId ? candidate.itemId === itemId : candidate.status === "running" || candidate.status === "needs_attention");
        if (!step)
            return null;
        step.status = status;
        step.completedAt = Date.now();
        this.save();
        return step;
    }
    addArtifact(runId, input) {
        const run = this.run(runId);
        if (!run)
            return null;
        const artifact = { ...input, id: newId(), createdAt: Date.now() };
        run.artifacts.push(artifact);
        this.save();
        return artifact;
    }
    markNeedsAttention(runId, title, itemId) {
        const run = this.run(runId);
        if (!run)
            return;
        run.status = "needs_attention";
        const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
        if (task) {
            task.status = "needs_attention";
            task.updatedAt = Date.now();
        }
        this.addStep(runId, { kind: "approval", title, itemId, status: "needs_attention" });
    }
    resumeRun(runId, requestId, denied = false) {
        const run = this.run(runId);
        if (!run)
            return;
        this.completeStep(runId, requestId, denied ? "denied" : "completed");
        if (!denied) {
            run.status = "running";
            const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
            if (task) {
                task.status = "running";
                task.updatedAt = Date.now();
            }
        }
        this.save();
    }
    completeRun(runId, ok, error) {
        const run = this.run(runId);
        if (!run)
            return;
        const budgetTask = this.task(run.taskId);
        if (budgetTask)
            this.settleBudgetDuration(run, budgetTask, Date.now());
        if (run.budgetUsage?.exhaustionReason) {
            this.markBudgetExhausted(runId, run.budgetUsage.exhaustionReason);
            return;
        }
        const now = Date.now();
        run.status = ok ? "completed" : error === "interrupted" ? "cancelled" : "failed";
        run.completedAt = now;
        if (run.checkpoint && run.checkpoint.status !== "consumed") {
            // A normally settled attempt needs no recovery token. `consumed` is
            // reserved for a checkpoint linked to the exact successor attempt.
            delete run.checkpoint;
            delete run.resumeStatus;
            delete run.resumeUnsafeReason;
        }
        if (!ok && error)
            run.error = error;
        for (const step of run.steps) {
            if (step.status === "running" || step.status === "needs_attention") {
                step.status = ok ? "completed" : "failed";
                step.completedAt = now;
            }
        }
        const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
        if (task) {
            task.status = run.status;
            task.updatedAt = now;
        }
        if (run.routineId) {
            const routine = this.data.routines.find((candidate) => candidate.id === run.routineId);
            if (routine) {
                routine.lastStatus = ok ? "completed" : "failed";
                routine.lastError = ok ? undefined : error || "Run failed";
            }
        }
        this.save();
    }
    createRoutine(input) {
        const name = input.name.trim();
        const prompt = input.prompt.trim();
        if (!name || !prompt)
            throw Object.assign(new Error("routine name and task are required"), { status: 400 });
        if (name.length > ROUTINE_NAME_MAX_LENGTH)
            throw Object.assign(new Error("routine name is too long"), { status: 400 });
        if (prompt.length > ROUTINE_PROMPT_MAX_LENGTH)
            throw Object.assign(new Error("routine task is too long"), { status: 400 });
        const schedule = validateSchedule(input.schedule);
        const now = Date.now();
        const enabled = input.enabled ?? true;
        const routine = {
            id: newId(),
            botId: input.botId,
            name,
            prompt,
            schedule,
            enabled,
            catchUpPolicy: input.catchUpPolicy ?? "latest",
            nextRunAt: enabled ? nextOccurrence(schedule, now) : null,
            createdAt: now,
            updatedAt: now,
        };
        this.data.routines.push(routine);
        this.save();
        return routine;
    }
    patchRoutine(id, patch) {
        const routine = this.data.routines.find((candidate) => candidate.id === id);
        if (!routine)
            return null;
        if (patch.name !== undefined) {
            const name = patch.name.trim();
            if (!name)
                throw Object.assign(new Error("routine name required"), { status: 400 });
            if (name.length > ROUTINE_NAME_MAX_LENGTH)
                throw Object.assign(new Error("routine name is too long"), { status: 400 });
            routine.name = name;
        }
        if (patch.prompt !== undefined) {
            const prompt = patch.prompt.trim();
            if (!prompt)
                throw Object.assign(new Error("routine task required"), { status: 400 });
            if (prompt.length > ROUTINE_PROMPT_MAX_LENGTH)
                throw Object.assign(new Error("routine task is too long"), { status: 400 });
            routine.prompt = prompt;
        }
        if (patch.schedule !== undefined)
            routine.schedule = validateSchedule(patch.schedule);
        if (patch.enabled !== undefined)
            routine.enabled = patch.enabled;
        routine.nextRunAt = routine.enabled ? nextOccurrence(routine.schedule, Date.now()) : null;
        routine.updatedAt = Date.now();
        this.save();
        return routine;
    }
    deleteRoutine(id) {
        const before = this.data.routines.length;
        this.data.routines = this.data.routines.filter((routine) => routine.id !== id);
        if (before === this.data.routines.length)
            return false;
        this.save();
        return true;
    }
    dueRoutines(at = Date.now()) {
        return this.data.routines.filter((routine) => routine.enabled && routine.nextRunAt !== null && routine.nextRunAt <= at);
    }
    /** Atomically claim every due scheduler boundary before any provider await.
     * The persisted `lastScheduledFor` key prevents a timer overlap or restart
     * from dispatching the same occurrence twice. */
    claimDueRoutines(at = Date.now()) {
        const claims = [];
        let changed = false;
        for (const routine of this.data.routines) {
            if (!routine.enabled || routine.nextRunAt === null || routine.nextRunAt > at)
                continue;
            const firstDue = routine.nextRunAt;
            if (routine.lastScheduledFor === firstDue) {
                routine.nextRunAt = nextOccurrence(routine.schedule, at);
                routine.updatedAt = at;
                changed = true;
                continue;
            }
            const recent = at - firstDue <= ROUTINE_CATCH_UP_WINDOW_MS;
            const shouldRun = recent && (routine.catchUpPolicy ?? "latest") === "latest";
            const projected = shouldRun
                ? projectFromOccurrence(routine.schedule, firstDue, at, 256)
                : [];
            const scheduledFor = projected.at(-1) ?? firstDue;
            const skippedOccurrences = Math.max(0, projected.length - 1);
            routine.lastScheduledFor = scheduledFor;
            if (!shouldRun)
                routine.lastRunAt = at;
            routine.lastStatus = shouldRun ? "queued" : "missed";
            routine.lastError = shouldRun
                ? undefined
                : recent
                    ? "Catch-up is disabled for this routine."
                    : "The host was offline for more than 12 hours after the scheduled time.";
            routine.nextRunAt = nextOccurrence(routine.schedule, at);
            routine.updatedAt = at;
            claims.push({
                routineId: routine.id,
                scheduledFor,
                outcome: shouldRun ? "run" : "missed",
                skippedOccurrences,
            });
            changed = true;
        }
        if (changed)
            this.save();
        return claims;
    }
    projectRoutines(from, to, limit = 256, visibleBotIds) {
        const boundedLimit = Math.max(1, Math.min(512, Math.floor(limit)));
        const cursors = [];
        for (const routine of this.data.routines) {
            if (visibleBotIds && !visibleBotIds.has(routine.botId))
                continue;
            if (!routine.enabled || routine.nextRunAt === null || routine.nextRunAt > to)
                continue;
            let first = routine.nextRunAt;
            if (first < from && routine.schedule.kind === "interval") {
                const step = routine.schedule.everyMinutes * 60_000;
                first += Math.ceil((from - first) / step) * step;
            }
            else {
                for (let guard = 0; first < from && guard < 64; guard += 1) {
                    first = nextOccurrence(routine.schedule, first);
                }
            }
            if (first < from)
                continue;
            cursors.push({ routine, scheduledFor: first });
        }
        const projected = [];
        while (cursors.length && projected.length < boundedLimit) {
            cursors.sort((left, right) => left.scheduledFor - right.scheduledFor || left.routine.id.localeCompare(right.routine.id));
            const earliest = cursors[0];
            projected.push({ routineId: earliest.routine.id, scheduledFor: earliest.scheduledFor });
            const next = nextOccurrence(earliest.routine.schedule, earliest.scheduledFor);
            if (next <= to)
                earliest.scheduledFor = next;
            else
                cursors.shift();
        }
        return projected;
    }
    advanceRoutine(id, from = Date.now()) {
        const routine = this.data.routines.find((candidate) => candidate.id === id);
        if (!routine)
            return null;
        routine.nextRunAt = routine.enabled ? nextOccurrence(routine.schedule, from) : null;
        routine.updatedAt = Date.now();
        this.save();
        return routine;
    }
    markRoutineFailure(id, message) {
        const routine = this.data.routines.find((candidate) => candidate.id === id);
        if (!routine)
            return null;
        routine.lastRunAt = Date.now();
        routine.lastStatus = "failed";
        routine.lastError = message;
        routine.updatedAt = Date.now();
        this.save();
        return routine;
    }
}
