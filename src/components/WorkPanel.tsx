import { useMemo, useState } from "react";
import {
  AlertCircle,
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
  Play,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { api, useStore, type RoutineRecord, type TaskRecord } from "@/state/store";
import { cn } from "@/lib/cn";

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
  if (status === "needs_attention") return "bg-warning/10 text-warning";
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
  const [actionError, setActionError] = useState<string | null>(null);
  const run = state.workspace.runs.find((candidate) => candidate.id === task.latestRunId);
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
      </button>
      {open && (
        <div className="border-t border-hairline/40 px-3 py-3">
          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-secondary">{task.prompt}</div>
          {run?.lifecycle && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className={cn("rounded-full px-2 py-0.5", run.lifecycle.state === "working" ? "bg-accent/10 text-accent" : run.lifecycle.state === "waiting" ? "bg-warning/10 text-warning" : "bg-danger/10 text-danger")}>
                {run.lifecycle.state.replace("_", " ")}
              </span>
              <span className="text-ink-secondary">Last signal {relativeTime(run.lifecycle.lastActivityAt)}</span>
              {run.lifecycle.reason ? <span className="w-full text-ink-secondary">{run.lifecycle.reason}</span> : null}
            </div>
          )}
          {run?.lifecycleAlert && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-2 text-[11px] text-warning">
              <div className="font-medium">{run.lifecycleAlert.title}</div>
              <div className="mt-1 text-ink-secondary">Cumea did not stop the agent automatically. Open its chat to steer it or stop the current turn.</div>
            </div>
          )}
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
          {run?.error && <div className="mt-3 rounded-lg bg-danger/10 px-2.5 py-2 text-[11px] text-danger">{run.error}</div>}
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
    bot.messages
      .filter((message) => message.kind === "options" && message.card && !message.card.answered && !message.card.dismissed)
      .map((message) => ({ bot, message })),
  );
  const lifecycle = state.workspace.tasks.filter((task) => {
    if (task.status !== "needs_attention") return false;
    const run = state.workspace.runs.find((candidate) => candidate.id === task.latestRunId);
    return run?.attentionKind === "lifecycle";
  }).slice(-8).reverse();
  const failed = state.workspace.tasks.filter((task) => task.status === "failed").slice(-8).reverse();
  if (!pending.length && !lifecycle.length && !failed.length) {
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
      {lifecycle.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">Agent recovery</div>
          <div className="space-y-2">{lifecycle.map((task) => <TaskCard key={task.id} task={task} />)}</div>
        </div>
      )}
      {failed.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">Failed runs</div>
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
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{routine.name}</div>
                  <div className="mt-1 text-[11px] text-ink-secondary">{bot?.name ?? "Deleted bot"} · {scheduleLabel(routine)}</div>
                  {routine.nextRunAt && <div className="mt-1 text-[10px] text-ink-secondary">Next {relativeTime(routine.nextRunAt)}</div>}
                </div>
                <button disabled={pendingId === routine.id} onClick={() => void mutateRoutine(routine.id, "toggle", !routine.enabled)} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40" title={routine.enabled ? "Pause" : "Resume"}>
                  {routine.enabled ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button disabled={pendingId === routine.id} onClick={() => void mutateRoutine(routine.id, "run")} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40" title="Run now"><RotateCw size={14} /></button>
                <button disabled={pendingId === routine.id} onClick={() => void mutateRoutine(routine.id, "delete")} className="rounded-md p-1.5 text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40" title="Delete"><Trash2 size={14} /></button>
              </div>
              {routine.lastStatus && <div className={cn("mt-2 rounded-lg px-2 py-1 text-[10px]", statusStyle(routine.lastStatus))}>Last run: {routine.lastStatus}{routine.lastError ? ` — ${routine.lastError}` : ""}</div>}
            </div>
          );
        })}
      </div>
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
    () => state.bots.reduce((count, bot) => count + bot.messages.filter((message) => message.kind === "options" && message.card && !message.card.answered && !message.card.dismissed).length, 0),
    [state.bots],
  );
  return (
    <aside className="animate-panel-in flex h-full w-[430px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
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
