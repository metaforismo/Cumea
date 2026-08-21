import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  Inbox,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { api, useStore, visibleMessages, type RoutineRecord, type TaskRecord } from "@/state/store";
import { cn } from "@/lib/cn";
import { evidenceDisplayState } from "@/lib/objective-evidence";
import { createRoutineDraft, routineDraftAfterSaveAttempt, routineHistory, routinePatchFromDraft, type RoutineDraft, type RoutineHistoryStatus } from "@/lib/routine-detail";

type WorkTab = "attention" | "activity" | "routines" | "sections";

const tabs: Array<{ id: WorkTab; label: string; icon: typeof Inbox }> = [
  { id: "attention", label: "Needs you", icon: Inbox },
  { id: "activity", label: "Activity", icon: ListChecks },
  { id: "routines", label: "Routines", icon: CalendarClock },
  { id: "sections", label: "Sections", icon: Folder },
];

function statusStyle(status: string) {
  if (status === "completed") return "bg-success/10 text-success";
  if (status === "failed" || status === "cancelled" || status === "denied") return "bg-danger/10 text-danger";
  if (status === "needs_attention" || status === "interrupted" || status === "missed" || status === "unknown" || status === "applying" || status === "intended") return "bg-warning/10 text-warning";
  return "bg-accent/10 text-accent";
}

function relativeTime(at: number) {
  const seconds = Math.round((at - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function TaskCard({ task }: { task: TaskRecord }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [requirementLabel, setRequirementLabel] = useState("");
  const [evidencePending, setEvidencePending] = useState(false);
  const [selectedReferences, setSelectedReferences] = useState<Record<string, string>>({});
  const [resolvingEffectId, setResolvingEffectId] = useState<string | null>(null);
  const run = state.workspace.runs.find((candidate) => candidate.id === task.latestRunId);
  const taskRuns = state.workspace.runs.filter((candidate) => candidate.taskId === task.id);
  const budgetUsage = taskRuns.reduce((total, candidate) => ({
    toolCalls: total.toolCalls + (candidate.budgetUsage?.toolCalls ?? 0),
    computerActions: total.computerActions + (candidate.budgetUsage?.computerActions ?? 0),
    delegations: total.delegations + (candidate.budgetUsage?.delegations ?? 0),
    tokens: total.tokens + (candidate.budgetUsage?.tokens ?? 0),
  }), { toolCalls: 0, computerActions: 0, delegations: 0, tokens: 0 });
  const evidence = taskRuns.flatMap((candidate) => candidate.evidence ?? []);
  const effects = taskRuns.flatMap((candidate) => candidate.effects ?? []);
  const references = taskRuns.flatMap((candidate) => [
    ...candidate.steps.map((step) => ({ key: `${candidate.id}:step:${step.id}`, runId: candidate.id, kind: "step" as const, id: step.id, label: step.title })),
    ...candidate.artifacts.map((artifact) => ({ key: `${candidate.id}:artifact:${artifact.id}`, runId: candidate.id, kind: "artifact" as const, id: artifact.id, label: artifact.label })),
  ]);
  const bot = state.bots.find((candidate) => candidate.id === task.botId);
  const teach = async () => {
    setTeaching(true);
    setActionError(null);
    try {
      await api(`/api/tasks/${task.id}/teach`, {
        method: "POST",
        body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      dispatch({ type: "toggleWork", open: true, tab: "routines" });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTeaching(false);
    }
  };
  const retry = async () => {
    setRetrying(true);
    setActionError(null);
    try {
      await api(`/api/tasks/${task.id}/retry`, { method: "POST" });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRetrying(false);
    }
  };
  const resume = async () => {
    if (!run?.checkpoint) return;
    setResuming(true);
    setActionError(null);
    try {
      await api(`/api/runs/${run.id}/resume`, {
        method: "POST",
        body: JSON.stringify({ checkpointId: run.checkpoint.id }),
      });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setResuming(false);
    }
  };
  const addRequirement = async () => {
    if (!requirementLabel.trim()) return;
    setEvidencePending(true);
    setActionError(null);
    try {
      await api(`/api/tasks/${task.id}/evidence-requirements`, {
        method: "POST",
        body: JSON.stringify({ label: requirementLabel }),
      });
      setRequirementLabel("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setEvidencePending(false);
    }
  };
  const removeRequirement = async (requirementId: string) => {
    setEvidencePending(true);
    setActionError(null);
    try {
      await api(`/api/tasks/${task.id}/evidence-requirements/${requirementId}`, { method: "DELETE" });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setEvidencePending(false);
    }
  };
  const observeEvidence = async (requirementId: string) => {
    const selected = references.find((candidate) => candidate.key === (selectedReferences[requirementId] ?? references[0]?.key));
    if (!selected) return;
    setEvidencePending(true);
    setActionError(null);
    try {
      await api(`/api/tasks/${task.id}/evidence`, {
        method: "POST",
        body: JSON.stringify({
          requirementId,
          runId: selected.runId,
          reference: { kind: selected.kind, id: selected.id },
        }),
      });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setEvidencePending(false);
    }
  };
  const resolveEffect = async (effectId: string, resolution: "applied" | "failed") => {
    const note = window.prompt(
      resolution === "applied"
        ? "How did you independently confirm this effect was applied?"
        : "How did you independently confirm this effect was not applied?",
    );
    if (!note?.trim()) return;
    setResolvingEffectId(effectId);
    setActionError(null);
    try {
      await api(`/api/effects/${effectId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution, note }),
      });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setResolvingEffectId(null);
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-hairline/40 bg-card">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-start gap-3 p-3 text-left hover:bg-raised/40">
        <span className="mt-0.5 text-ink-secondary">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink">{task.title}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-secondary">
            <span>{bot?.name ?? "Deleted bot"}</span>
            <span>·</span>
            <span>{relativeTime(task.updatedAt)}</span>
          </div>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px]", statusStyle(task.status))}>
          {task.status.replace("_", " ")}
        </span>
        {task.verificationStatus && task.verificationStatus !== "not_required" && (
          <span
            title="Verification is separate from task completion"
            className={cn("rounded-full px-2 py-0.5 text-[10px]", task.verificationStatus === "verified" ? "bg-success/10 text-success" : task.verificationStatus === "failed" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")}
          >
            {task.verificationStatus === "verified" ? "verified" : `evidence ${task.verificationStatus}`}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-hairline/40 px-3 py-3">
          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-secondary">{task.prompt}</div>
          {run?.steps.length ? (
            <div className="mt-3 space-y-2">
              {run.steps.map((step) => (
                <div key={step.id} className="flex items-center gap-2 text-[12px]">
                  {step.status === "completed" ? (
                    <CheckCircle2 size={13} className="text-success" />
                  ) : step.status === "failed" || step.status === "denied" ? (
                    <AlertCircle size={13} className="text-danger" />
                  ) : (
                    <Clock3 size={13} className="text-warning" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-ink">{step.title}</span>
                  <span className="text-[10px] text-ink-secondary">{step.kind}</span>
                </div>
              ))}
            </div>
          ) : null}
          {effects.length ? (
            <div className="mt-3 space-y-2" aria-label="External effect receipts">
              {effects.map((effect) => (
                <div key={effect.id} className="rounded-lg border border-hairline/40 bg-inset/40 p-2.5">
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={13} className={effect.state === "applied" ? "text-success" : effect.state === "failed" ? "text-danger" : "text-warning"} />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{effect.descriptor.boundary}</span>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px]", statusStyle(effect.state))}>{effect.state}</span>
                    <span className="text-[9px] text-ink-secondary">attempt {effect.attempt}</span>
                  </div>
                  <div className="mt-1 text-[10px] leading-4 text-ink-secondary">
                    {effect.origin === "provider_observation"
                      ? "Observed after an opaque provider boundary; Cumea will not replay it automatically."
                      : "Durable receipt for a controlled external boundary."}
                  </div>
                  {effect.state === "unknown" && (
                    <div className="mt-2 flex gap-1.5">
                      <button disabled={resolvingEffectId === effect.id} onClick={() => void resolveEffect(effect.id, "applied")} className="rounded-md bg-raised px-2 py-1 text-[10px] text-ink hover:bg-raised-hover disabled:opacity-40">Confirm applied</button>
                      <button disabled={resolvingEffectId === effect.id} onClick={() => void resolveEffect(effect.id, "failed")} className="rounded-md bg-raised px-2 py-1 text-[10px] text-ink hover:bg-raised-hover disabled:opacity-40">Confirm not applied</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {run?.compaction ? (
            <div className="mt-3 rounded-lg bg-inset/40 px-2.5 py-2 text-[10px] text-ink-secondary">
              {run.compaction.compacted
                ? `Context compacted: ${run.compaction.submittedMessages}/${run.compaction.originalMessages} messages, ${run.compaction.omittedMessages} omitted · ~${run.compaction.estimatedSubmittedTokens} estimated tokens`
                : `Replay context unchanged: ${run.compaction.submittedMessages} messages · ~${run.compaction.estimatedSubmittedTokens} estimated tokens`}
              <span className="ml-1">(structural estimate, not provider usage)</span>
            </div>
          ) : null}
          {run?.artifacts.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {run.artifacts.map((artifact) =>
                artifact.attachmentId ? (
                  <a
                    key={artifact.id}
                    href={`/api/attachments/${artifact.attachmentId}`}
                    className="flex items-center gap-1 rounded-lg bg-inset px-2 py-1 text-[11px] text-ink hover:bg-raised"
                  >
                    <FileText size={12} /> {artifact.label}
                  </a>
                ) : (
                  <button
                    key={artifact.id}
                    onClick={() => {
                      if (bot) dispatch({ type: "select", id: bot.id });
                      dispatch({ type: "toggleWork", open: false });
                    }}
                    className="rounded-lg bg-inset px-2 py-1 text-[11px] text-ink hover:bg-raised"
                  >
                    {artifact.label}
                  </button>
                ),
              )}
            </div>
          ) : null}
          {task.budget && (
            <div className="mt-3 rounded-lg border border-hairline/40 bg-inset/40 p-2.5" aria-label="Task budget usage">
              <div className="flex items-center gap-2 text-[11px] font-medium text-ink"><Clock3 size={13} /> Task limits</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-ink-secondary">
                {task.budget.durationMs !== undefined && <span className="rounded-full bg-card px-2 py-1">{Math.round(task.budget.durationMs / 60_000)} min</span>}
                {task.budget.toolCalls !== undefined && <span className="rounded-full bg-card px-2 py-1">tools {budgetUsage.toolCalls}/{task.budget.toolCalls}</span>}
                {task.budget.computerActions !== undefined && <span className="rounded-full bg-card px-2 py-1">computer {budgetUsage.computerActions}/{task.budget.computerActions}</span>}
                {task.budget.delegations !== undefined && <span className="rounded-full bg-card px-2 py-1">delegations {budgetUsage.delegations}/{task.budget.delegations}</span>}
                {task.budget.tokens !== undefined && <span className="rounded-full bg-card px-2 py-1">tokens {taskRuns.some((candidate) => candidate.budgetUsage?.tokens !== undefined) ? `${budgetUsage.tokens}/${task.budget.tokens}` : "telemetry unavailable"}</span>}
              </div>
              {taskRuns.find((candidate) => candidate.budgetUsage?.exhaustionReason)?.budgetUsage?.exhaustionReason && <div className="mt-2 text-[10px] text-warning">Limit reached: {taskRuns.find((candidate) => candidate.budgetUsage?.exhaustionReason)!.budgetUsage!.exhaustionReason}</div>}
            </div>
          )}
          <div className="mt-3 rounded-lg border border-hairline/40 bg-inset/40 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
              <ShieldCheck size={13} /> Acceptance evidence
            </div>
            <div className="mt-1 text-[10px] leading-4 text-ink-secondary">
              Observed run records are auditable, but only an independent verifier can mark them verified.
            </div>
            {(task.evidenceRequirements ?? []).map((requirement) => {
              const records = evidence.filter((record) => record.requirementId === requirement.id);
              const strongest = evidenceDisplayState(records);
              return (
                <div key={requirement.id} className="mt-2 rounded-md bg-card px-2 py-2">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[11px] leading-4 text-ink">{requirement.label}</span>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px]", strongest === "verified" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>{strongest}</span>
                    <button disabled={evidencePending} onClick={() => void removeRequirement(requirement.id)} aria-label={`Remove evidence requirement ${requirement.label}`} className="text-ink-secondary hover:text-danger disabled:opacity-40"><X size={12} /></button>
                  </div>
                  {references.length > 0 && strongest !== "verified" && (
                    <div className="mt-2 flex gap-1.5">
                      <select
                        aria-label={`Evidence for ${requirement.label}`}
                        value={selectedReferences[requirement.id] ?? references[0].key}
                        onChange={(event) => setSelectedReferences((current) => ({ ...current, [requirement.id]: event.target.value }))}
                        className="min-w-0 flex-1 rounded-md bg-inset px-2 py-1 text-[10px] text-ink outline-none"
                      >
                        {references.map((reference) => <option key={reference.key} value={reference.key}>{reference.kind}: {reference.label}</option>)}
                      </select>
                      <button disabled={evidencePending} onClick={() => void observeEvidence(requirement.id)} className="rounded-md bg-raised px-2 py-1 text-[10px] text-ink hover:bg-raised-hover disabled:opacity-40">Record</button>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="mt-2 flex gap-1.5">
              <input
                value={requirementLabel}
                maxLength={500}
                onChange={(event) => setRequirementLabel(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void addRequirement(); }}
                placeholder="Add an acceptance requirement"
                aria-label="Acceptance evidence requirement"
                className="min-w-0 flex-1 rounded-md bg-card px-2 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink-secondary"
              />
              <button disabled={evidencePending || !requirementLabel.trim()} onClick={() => void addRequirement()} aria-label="Add evidence requirement" className="rounded-md bg-raised p-1.5 text-ink hover:bg-raised-hover disabled:opacity-40"><Plus size={13} /></button>
            </div>
          </div>
          {run?.error && <div className="mt-3 rounded-lg bg-danger/10 px-2.5 py-2 text-[11px] text-danger">{run.error}</div>}
          {task.status === "interrupted" && run?.resumeStatus === "available" && run.checkpoint?.status === "available" && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-warning"><Pause size={12} /> Interrupted safely</div>
              <div className="mt-1 text-[10px] leading-4 text-ink-secondary">
                Resume reconstructs the surviving conversation. Cumea uses a provider session only when its provider, model, cursor and conversation branch still match; otherwise it starts a fresh provider session.
              </div>
              <button
                onClick={() => void resume()}
                disabled={resuming || bot?.busy}
                className="mt-2 flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[11px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40"
              >
                <Play size={12} /> {resuming ? "Resuming…" : "Resume interrupted run"}
              </button>
            </div>
          )}
          {task.status === "interrupted" && run?.resumeStatus === "unsafe" && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-2 text-[11px] text-warning">
              Resume is blocked until this checkpoint is safe{run.resumeUnsafeReason === "unknown_effect" ? ": resolve the unknown external effect above first." : ". Review the transcript, provider and conversation branch before starting a new task."}
            </div>
          )}
          {actionError && <div className="mt-3 rounded-lg bg-danger/10 px-2.5 py-2 text-[11px] text-danger">{actionError}</div>}
          {(task.status === "failed" || task.status === "cancelled") && (
            <button
              onClick={() => void retry()}
              disabled={retrying || bot?.busy}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[11px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40"
            >
              <RotateCw size={12} className={retrying ? "animate-spin" : ""} /> Retry task
            </button>
          )}
          {task.status === "completed" && (
            <button
              onClick={() => void teach()}
              disabled={teaching}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[11px] font-medium text-ink hover:bg-raised-hover"
            >
              <RotateCw size={12} className={teaching ? "animate-spin" : ""} /> Teach as routine
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AttentionTab() {
  const { state, dispatch } = useStore();
  const pending = state.bots.flatMap((bot) =>
    visibleMessages(bot)
      .filter((message) => message.kind === "options" && message.card && !message.card.answered && !message.card.dismissed)
      .map((message) => ({ bot, message })),
  );
  const failed = state.workspace.tasks.filter((task) => task.status === "failed" || task.status === "interrupted").slice(-8).reverse();
  if (!pending.length && !failed.length) {
    return <div className="py-16 text-center text-[13px] text-ink-secondary">Nothing needs your attention.</div>;
  }
  return (
    <div className="space-y-4">
      {pending.map(({ bot, message }) => (
        <button
          key={message.id}
          onClick={() => {
            dispatch({ type: "select", id: bot.id });
            dispatch({ type: "toggleWork", open: false });
          }}
          className="w-full rounded-xl border border-warning/30 bg-warning/5 p-3 text-left hover:bg-warning/10"
        >
          <div className="flex items-center gap-2 text-[12px] font-medium text-warning">
            <AlertCircle size={14} /> {message.card!.title}
          </div>
          <div className="mt-1.5 text-[13px] text-ink">{message.card!.subtitle}</div>
          <div className="mt-2 text-[11px] text-ink-secondary">{bot.name}</div>
        </button>
      ))}
      {failed.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">Interrupted or failed runs</div>
          <div className="space-y-2">{failed.map((task) => <TaskCard key={task.id} task={task} />)}</div>
        </div>
      )}
    </div>
  );
}

function ActivityTab() {
  const { state } = useStore();
  const tasks = [...state.workspace.tasks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
  return tasks.length ? (
    <div className="space-y-2">{tasks.map((task) => <TaskCard key={task.id} task={task} />)}</div>
  ) : (
    <div className="py-16 text-center text-[13px] text-ink-secondary">Tasks will appear here as your bots work.</div>
  );
}

function scheduleLabel(routine: RoutineRecord) {
  const schedule = routine.schedule;
  if (schedule.kind === "interval") return `Every ${schedule.everyMinutes} minutes`;
  if (schedule.kind === "daily") return `Daily at ${schedule.time}`;
  return `Weekly at ${schedule.time}`;
}

export function RoutinePrivacyBoundary() {
  return (
    <p className="text-[11px] leading-4 text-ink-secondary">
      Prompt is write-only here. Leave the replacement blank to keep the current task unchanged.
    </p>
  );
}

function historyStatusStyle(status: RoutineHistoryStatus) {
  if (status === "success") return "bg-success/10 text-success";
  if (status === "failure") return "bg-danger/10 text-danger";
  if (status === "needs-you") return "bg-warning/10 text-warning";
  return "bg-accent/10 text-accent";
}

function RoutineDetailDrawer({
  routine,
  occurrences,
  restoreFocusTo,
  onClose,
  onDeleted,
}: {
  routine: RoutineRecord;
  occurrences: Array<{ routineId: string; scheduledFor: number }>;
  restoreFocusTo: HTMLElement | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { state, dispatch } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [draft, setDraft] = useState<RoutineDraft>(() => createRoutineDraft(routine, browserTimezone));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const bot = state.bots.find((candidate) => candidate.id === routine.botId);
  const ownerUnavailable = !bot || bot.hidden;
  const history = useMemo(
    () => routineHistory(state.workspace.tasks, state.workspace.runs, routine.id),
    [routine.id, state.workspace.runs, state.workspace.tasks],
  );
  const nextOccurrences = occurrences.filter((item) => item.routineId === routine.id).slice(0, 8);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]";
    const first = dialog.querySelector<HTMLElement>(focusableSelector);
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const firstElement = focusable[0];
      const lastElement = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusTo?.focus();
    };
  }, [onClose, restoreFocusTo]);

  const save = async () => {
    setSaved(false);
    setSaveError(null);
    let patch: ReturnType<typeof routinePatchFromDraft>;
    try {
      patch = routinePatchFromDraft(draft);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    setSaving(true);
    try {
      await api(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setDraft((current) => routineDraftAfterSaveAttempt(current, true));
      setSaved(true);
    } catch (reason) {
      // Intentionally keep the complete draft so a transient PATCH failure
      // never destroys the user's edits.
      setDraft((current) => routineDraftAfterSaveAttempt(current, false));
      setSaveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this routine and its future schedule? Existing task and run history is kept.")) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await api(`/api/routines/${routine.id}`, { method: "DELETE" });
      onDeleted();
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : String(reason));
      setDeleting(false);
    }
  };

  const openAgent = (botId: string) => {
    dispatch({ type: "select", id: botId });
    dispatch({ type: "toggleWork", open: false });
  };

  return (
    <div className="absolute inset-0 z-20 bg-panel/80" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-detail-title"
        className="ml-auto flex h-full w-full max-w-[430px] flex-col border-l border-hairline/40 bg-panel shadow-[-16px_0_48px_rgba(0,0,0,0.28)] motion-safe:animate-panel-in"
      >
        <div className="flex min-h-14 items-center gap-3 border-b border-hairline/40 px-4">
          <div className="min-w-0 flex-1">
            <h2 id="routine-detail-title" className="truncate text-[15px] font-semibold text-ink">{routine.name}</h2>
            <p className="truncate text-[11px] text-ink-secondary">{ownerUnavailable ? "Agent unavailable" : bot.name}</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink" aria-label="Close routine details"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {ownerUnavailable && (
            <div role="status" className="mb-4 rounded-xl bg-warning/10 px-3 py-2.5 text-[12px] leading-5 text-warning">
              This routine’s agent was deleted or hidden. Editing and opening the agent are unavailable; saved history remains visible.
            </div>
          )}

          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label className="block text-[11px] font-medium text-ink-secondary">
              Name
              <input
                autoComplete="off"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                className="mt-1.5 min-h-11 w-full rounded-lg bg-inset px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="block text-[11px] font-medium text-ink-secondary">
              Replace task prompt
              <textarea
                autoComplete="off"
                value={draft.replacementPrompt}
                onChange={(event) => setDraft((current) => ({ ...current, replacementPrompt: event.target.value }))}
                placeholder="Enter a new task only if you want to replace it"
                className="mt-1.5 min-h-24 w-full resize-y rounded-lg bg-inset px-3 py-2.5 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-secondary focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <RoutinePrivacyBoundary />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-medium text-ink-secondary">
                Schedule
                <select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as RoutineDraft["kind"] }))} className="mt-1.5 min-h-11 w-full rounded-lg bg-inset px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="interval">Interval</option>
                </select>
              </label>
              {draft.kind === "interval" ? (
                <label className="text-[11px] font-medium text-ink-secondary">
                  Minutes
                  <input type="number" min={5} max={43200} value={draft.everyMinutes} onChange={(event) => setDraft((current) => ({ ...current, everyMinutes: Number(event.target.value) }))} className="mt-1.5 min-h-11 w-full rounded-lg bg-inset px-3 text-[13px] tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                </label>
              ) : (
                <label className="text-[11px] font-medium text-ink-secondary">
                  Time
                  <input type="time" value={draft.time} onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))} className="mt-1.5 min-h-11 w-full rounded-lg bg-inset px-3 text-[13px] tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                </label>
              )}
            </div>
            {draft.kind === "weekly" && (
              <fieldset>
                <legend className="text-[11px] font-medium text-ink-secondary">Weekdays</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => (
                    <label key={day} className="flex min-h-11 items-center gap-2 rounded-lg bg-inset px-3 text-[12px] text-ink">
                      <input
                        type="checkbox"
                        checked={draft.weekdays.includes(index)}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          weekdays: event.target.checked
                            ? [...new Set([...current.weekdays, index])].sort((left, right) => left - right)
                            : current.weekdays.filter((weekday) => weekday !== index),
                        }))}
                        className="size-5 accent-accent"
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {draft.kind !== "interval" && <p className="text-[11px] text-ink-secondary">Wall-clock time in {draft.timezone}; daylight-saving changes follow this IANA timezone.</p>}
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-inset px-3 text-[13px] text-ink">
              Enabled
              <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} className="size-5 accent-accent" />
            </label>
            <div aria-live="polite">
              {saveError && <div className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] leading-5 text-danger">Couldn’t save. Your edits are still here. {saveError}</div>}
              {saved && !saveError && <div className="rounded-lg bg-success/10 px-3 py-2 text-[12px] text-success">Routine saved.</div>}
            </div>
            <button type="submit" disabled={saving || ownerUnavailable || !draft.name.trim()} className="flex min-h-11 w-full items-center justify-center rounded-lg bg-ink px-4 text-[13px] font-medium text-app hover:opacity-90 disabled:opacity-40">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </form>

          <section aria-labelledby="routine-upcoming-title" className="mt-7 border-t border-hairline/40 pt-5">
            <h3 id="routine-upcoming-title" className="text-[13px] font-semibold text-ink">Next occurrences</h3>
            <div className="mt-2 space-y-1" role="list">
              {nextOccurrences.length ? nextOccurrences.map((occurrence) => (
                <time key={occurrence.scheduledFor} role="listitem" dateTime={new Date(occurrence.scheduledFor).toISOString()} className="flex min-h-11 items-center justify-between rounded-lg bg-inset px-3 text-[12px] text-ink">
                  <span>{new Date(occurrence.scheduledFor).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span>
                  <span className="tabular-nums text-ink-secondary">{new Date(occurrence.scheduledFor).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </time>
              )) : <p className="rounded-lg bg-inset px-3 py-3 text-[12px] text-ink-secondary">No occurrence in the next 7 days.</p>}
            </div>
          </section>

          <section aria-labelledby="routine-history-title" className="mt-7 border-t border-hairline/40 pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 id="routine-history-title" className="text-[13px] font-semibold text-ink">Task and run history</h3>
              <span className="text-[11px] tabular-nums text-ink-secondary">{history.length}</span>
            </div>
            <div className="mt-2 space-y-2" role="list">
              {history.length ? history.map((item) => {
                const itemBotId = item.task?.botId ?? item.run?.botId;
                const itemBot = state.bots.find((candidate) => candidate.id === itemBotId);
                const canOpen = Boolean(itemBot && !itemBot.hidden);
                return (
                  <div key={item.run ? `${item.run.taskId}:${item.run.id}` : `${item.task!.id}:task`} role="listitem" className="rounded-xl bg-inset px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-ink">{item.task?.title ?? "Run without task record"}</div>
                        <time dateTime={new Date(item.at).toISOString()} className="mt-1 block text-[10px] tabular-nums text-ink-secondary">{new Date(item.at).toLocaleString()}</time>
                      </div>
                      <span className={cn("rounded-full px-2 py-1 text-[10px]", historyStatusStyle(item.status))}>{item.status}</span>
                    </div>
                    {item.run?.attempt && item.run.attempt > 1 && <p className="mt-1 text-[10px] tabular-nums text-ink-secondary">Attempt {item.run.attempt}</p>}
                    {item.run?.error && <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-danger">{item.run.error}</p>}
                    {canOpen && (
                      <button type="button" onClick={() => openAgent(itemBotId!)} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-raised px-3 text-[12px] font-medium text-ink hover:bg-raised-hover">
                        Open agent <ArrowUpRight size={14} />
                      </button>
                    )}
                  </div>
                );
              }) : <p className="rounded-lg bg-inset px-3 py-3 text-[12px] text-ink-secondary">No canonical task or run has been recorded for this routine.</p>}
            </div>
          </section>

          <button type="button" disabled={deleting} onClick={() => void remove()} className="mt-7 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg text-[12px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40">
            <Trash2 size={15} /> {deleting ? "Deleting…" : "Delete routine"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoutinesTab() {
  const { state } = useStore();
  const [creating, setCreating] = useState(false);
  const [botId, setBotId] = useState(state.selectedId);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"daily" | "weekly" | "interval">("daily");
  const [time, setTime] = useState("09:00");
  const [minutes, setMinutes] = useState(60);
  const [weekday, setWeekday] = useState(new Date().getDay());
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<"agenda" | "week">("agenda");
  const [occurrences, setOccurrences] = useState<Array<{ routineId: string; scheduledFor: number }>>([]);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [routineNotice, setRoutineNotice] = useState<string | null>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const selectedRoutine = state.workspace.routines.find((candidate) => candidate.id === selectedRoutineId);

  useEffect(() => {
    if (selectedRoutineId && !selectedRoutine) {
      setSelectedRoutineId(null);
      setRoutineNotice("That routine is no longer available. Its existing task and run history remains in Activity.");
    }
  }, [selectedRoutine, selectedRoutineId]);

  useEffect(() => {
    const controller = new AbortController();
    const from = Date.now();
    const to = from + 7 * 24 * 60 * 60_000;
    void api(`/api/routines/occurrences?from=${from}&to=${to}&limit=256`, { signal: controller.signal })
      .then((body) => {
        const candidate = (body as { occurrences?: unknown }).occurrences;
        if (Array.isArray(candidate)) {
          setOccurrences(candidate.flatMap((value) => {
            if (!value || typeof value !== "object") return [];
            const item = value as { routineId?: unknown; scheduledFor?: unknown };
            return typeof item.routineId === "string" && typeof item.scheduledFor === "number"
              ? [{ routineId: item.routineId, scheduledFor: item.scheduledFor }]
              : [];
          }));
        }
      })
      .catch((reason) => {
        if ((reason as { name?: string })?.name !== "AbortError") setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [state.workspace.routines]);

  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(start);
      date.setDate(start.getDate() + offset);
      const next = new Date(date);
      next.setDate(date.getDate() + 1);
      return {
        key: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString([], { weekday: "short", day: "numeric" }),
        occurrences: occurrences.filter((occurrence) => occurrence.scheduledFor >= date.getTime() && occurrence.scheduledFor < next.getTime()),
      };
    });
  }, [occurrences]);

  const create = async () => {
    setError(null);
    const schedule = kind === "interval"
      ? { kind, everyMinutes: minutes }
      : kind === "weekly"
        ? { kind, time, timezone, weekdays: [weekday] }
        : { kind, time, timezone };
    try {
      await api("/api/routines", {
        method: "POST",
        body: JSON.stringify({ botId, name, prompt, schedule }),
      });
      setName("");
      setPrompt("");
      setCreating(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const mutateRoutine = async (id: string, action: "toggle" | "run" | "delete", enabled?: boolean) => {
    if (action === "delete" && !window.confirm("Delete this routine and its future schedule? Existing run history is kept.")) return;
    setPendingId(id);
    setError(null);
    try {
      if (action === "toggle") {
        await api(`/api/routines/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      } else if (action === "run") {
        await api(`/api/routines/${id}/run`, { method: "POST" });
      } else {
        await api(`/api/routines/${id}`, { method: "DELETE" });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div>
      {routineNotice && <div role="status" className="mb-3 rounded-lg bg-warning/10 px-2.5 py-2 text-[12px] leading-5 text-warning">{routineNotice}</div>}
      <div className="mb-3 rounded-xl border border-hairline/40 bg-card p-2" aria-label="Upcoming routine calendar">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div>
            <div className="text-[12px] font-medium text-ink">Next 7 days</div>
            <div className="text-[10px] text-ink-secondary">Times shown in {timezone}</div>
          </div>
          <div className="flex rounded-lg bg-inset p-0.5" role="group" aria-label="Calendar view">
            {(["agenda", "week"] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={calendarView === view}
                onClick={() => setCalendarView(view)}
                className={cn("rounded-md px-2 py-1 text-[10px] capitalize", calendarView === view ? "bg-card text-ink" : "text-ink-secondary hover:text-ink")}
              >
                {view}
              </button>
            ))}
          </div>
        </div>
        {calendarView === "week" ? (
          <div className="grid grid-cols-7 gap-1" role="list" aria-label="Week projection">
            {days.map((day) => (
              <div key={day.key} role="listitem" className="min-w-0 rounded-lg bg-inset px-1 py-2 text-center">
                <div className="truncate text-[9px] font-medium text-ink-secondary">{day.label}</div>
                <div className="mt-1 text-[13px] font-semibold tabular-nums text-ink">{day.occurrences.length}</div>
                <div className="text-[8px] text-ink-secondary">runs</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-h-44 space-y-1 overflow-y-auto" role="list" aria-label="Upcoming occurrences">
            {occurrences.length ? occurrences.slice(0, 40).map((occurrence) => {
              const routine = state.workspace.routines.find((candidate) => candidate.id === occurrence.routineId);
              if (!routine) return null;
              return (
                <div key={`${occurrence.routineId}:${occurrence.scheduledFor}`} role="listitem" className="flex items-center gap-2 rounded-lg bg-inset px-2 py-1.5">
                  <time dateTime={new Date(occurrence.scheduledFor).toISOString()} className="w-16 shrink-0 text-[10px] tabular-nums text-ink-secondary">
                    {new Date(occurrence.scheduledFor).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                  </time>
                  <span className="truncate text-[11px] text-ink">{routine.name}</span>
                </div>
              );
            }) : <div className="px-2 py-4 text-center text-[11px] text-ink-secondary">No enabled routines in the next 7 days.</div>}
          </div>
        )}
      </div>
      <button
        onClick={() => setCreating((value) => !value)}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-hairline bg-card/40 py-2.5 text-[13px] text-ink hover:bg-card"
      >
        <Plus size={15} /> New routine
      </button>
      {creating && (
        <div className="mb-4 space-y-3 rounded-xl border border-hairline/40 bg-card p-3">
          <select value={botId} onChange={(event) => setBotId(event.target.value)} className="w-full rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none">
            {state.bots.filter((bot) => !bot.hidden).map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
          </select>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Routine name" className="w-full rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none" />
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What should the bot do?" className="min-h-24 w-full resize-none rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none" />
          <div className="grid grid-cols-2 gap-2">
            <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none">
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="interval">Interval</option>
            </select>
            {kind === "interval" ? (
              <input type="number" min={5} max={43200} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} aria-label="Minutes between runs" className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none" />
            ) : (
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none" />
            )}
          </div>
          {kind === "weekly" && (
            <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))} className="w-full rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none">
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select>
          )}
          {error && <div className="text-[12px] text-danger">{error}</div>}
          <button onClick={() => void create()} disabled={!botId || !name.trim() || !prompt.trim()} className="w-full rounded-lg bg-ink py-2 text-[13px] font-medium text-app disabled:opacity-40">Create routine</button>
        </div>
      )}
      {!creating && error && <div className="mb-3 rounded-lg bg-danger/10 px-2.5 py-2 text-[12px] text-danger">{error}</div>}
      <div className="space-y-2">
        {[...state.workspace.routines].sort((a, b) => b.updatedAt - a.updatedAt).map((routine) => {
          const bot = state.bots.find((candidate) => candidate.id === routine.botId);
          return (
            <div key={routine.id} className="rounded-xl border border-hairline/40 bg-card p-3">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    detailOpenerRef.current = event.currentTarget;
                    setRoutineNotice(null);
                    setSelectedRoutineId(routine.id);
                  }}
                  className="min-h-11 min-w-0 flex-1 rounded-lg px-1 text-left outline-none hover:bg-raised/40 focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`Edit ${routine.name} and view history`}
                >
                  <div className="truncate text-[13px] font-medium text-ink">{routine.name}</div>
                  <div className="mt-1 text-[11px] text-ink-secondary">{bot?.name ?? "Deleted bot"} · {scheduleLabel(routine)}</div>
                  {routine.nextRunAt && <div className="mt-1 text-[10px] text-ink-secondary">Next {relativeTime(routine.nextRunAt)}</div>}
                </button>
                <button disabled={pendingId === routine.id || !bot || bot.hidden} onClick={() => void mutateRoutine(routine.id, "toggle", !routine.enabled)} className="flex size-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40" title={routine.enabled ? "Pause" : "Resume"} aria-label={`${routine.enabled ? "Pause" : "Resume"} ${routine.name}`}>
                  {routine.enabled ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button disabled={pendingId === routine.id || !bot || bot.hidden} onClick={() => void mutateRoutine(routine.id, "run")} className="flex size-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40" title="Run now" aria-label={`Run ${routine.name} now`}><RotateCw size={14} /></button>
                <button type="button" onClick={(event) => { detailOpenerRef.current = event.currentTarget; setSelectedRoutineId(routine.id); }} className="flex size-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink" aria-label={`Open details for ${routine.name}`}><Pencil size={14} /></button>
              </div>
              {routine.lastStatus && <div className={cn("mt-2 rounded-lg px-2 py-1 text-[10px]", statusStyle(routine.lastStatus))}>Last run: {routine.lastStatus}{routine.lastError ? ` — ${routine.lastError}` : ""}</div>}
            </div>
          );
        })}
      </div>
      {selectedRoutine && (
        <RoutineDetailDrawer
          key={selectedRoutine.id}
          routine={selectedRoutine}
          occurrences={occurrences}
          restoreFocusTo={detailOpenerRef.current}
          onClose={() => setSelectedRoutineId(null)}
          onDeleted={() => {
            setSelectedRoutineId(null);
            setRoutineNotice("Routine deleted. Existing task and run history is still available in Activity.");
          }}
        />
      )}
    </div>
  );
}

function SectionsTab() {
  const { state } = useStore();
  const [name, setName] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const create = async () => {
    try {
      await api("/api/sections", { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const rename = async (id: string, name: string) => {
    setPendingId(id);
    setError(null);
    try {
      await api(`/api/sections/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingId(null);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this section? Its agents will move back to the ungrouped list.")) return;
    setPendingId(id);
    setError(null);
    try {
      await api(`/api/sections/${id}`, { method: "DELETE" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingId(null);
    }
  };
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void create()} placeholder="New section" className="min-w-0 flex-1 rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none" />
        <button onClick={() => void create()} disabled={!name.trim()} className="rounded-lg bg-ink px-3 text-[13px] font-medium text-app disabled:opacity-40">Add</button>
      </div>
      {error && <div className="mb-3 text-[12px] text-danger">{error}</div>}
      <div className="space-y-2">
        {state.workspace.sections.map((section) => (
          <div key={section.id} className="flex items-center gap-2 rounded-xl bg-card p-2.5">
            <Folder size={15} className="text-ink-secondary" />
            <input
              value={edits[section.id] ?? section.name}
              onChange={(event) => setEdits((current) => ({ ...current, [section.id]: event.target.value }))}
              onBlur={() => {
                const value = edits[section.id];
                if (value && value !== section.name) void rename(section.id, value);
              }}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
            />
            <span className="text-[11px] text-ink-secondary">{state.bots.filter((bot) => bot.sectionId === section.id).length}</span>
            <button disabled={pendingId === section.id} onClick={() => void remove(section.id)} className="rounded-md p-1.5 text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkPanel() {
  const { state, dispatch } = useStore();
  const active = tabs.find((tab) => tab.id === state.workTab) ?? tabs[0];
  const unresolvedCount = useMemo(
    () => state.bots.reduce((count, bot) => count + visibleMessages(bot).filter((message) => message.kind === "options" && message.card && !message.card.answered && !message.card.dismissed).length, 0),
    [state.bots],
  );
  return (
    <aside className="work-panel relative flex h-full w-[430px] max-w-full shrink-0 flex-col border-l border-hairline/40 bg-panel motion-safe:animate-panel-in">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold text-ink">Work</span>
        <button onClick={() => dispatch({ type: "toggleWork", open: false })} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink" aria-label="Close work panel"><X size={18} /></button>
      </div>
      <div className="grid grid-cols-4 border-y border-hairline/40 px-2 py-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => dispatch({ type: "toggleWork", open: true, tab: tab.id })} className={cn("relative flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px]", state.workTab === tab.id ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink")}>
              <Icon size={15} /> {tab.label}
              {tab.id === "attention" && unresolvedCount > 0 && <span className="absolute right-2 top-1 size-1.5 rounded-full bg-danger" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 px-4 pb-1 pt-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        <active.icon size={14} /> {active.label}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {state.workTab === "attention" && <AttentionTab />}
        {state.workTab === "activity" && <ActivityTab />}
        {state.workTab === "routines" && <RoutinesTab />}
        {state.workTab === "sections" && <SectionsTab />}
      </div>
    </aside>
  );
}
