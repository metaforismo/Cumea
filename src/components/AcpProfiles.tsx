import { Check, Loader2, Pencil, Plus, Terminal, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/state/store";
import { cn } from "@/lib/cn";

interface AcpProfile {
  id: string;
  label: string;
  executable: string;
  arguments: string[];
  versionArguments: string[];
  models: Array<{ id: string; label: string }>;
  defaultModel: string;
  authMethod?: string;
  requireAuthentication: boolean;
  workspace?: string;
  fullAuto: boolean;
  enabled: boolean;
}

interface ProfileDraft {
  label: string;
  executable: string;
  argumentsText: string;
  versionArgumentsText: string;
  modelsText: string;
  defaultModel: string;
  authMethod: string;
  workspace: string;
  requireAuthentication: boolean;
  fullAuto: boolean;
  enabled: boolean;
}

const EMPTY_DRAFT: ProfileDraft = {
  label: "",
  executable: "",
  argumentsText: "",
  versionArgumentsText: "--version",
  modelsText: "default | Default",
  defaultModel: "default",
  authMethod: "",
  workspace: "",
  requireAuthentication: false,
  fullAuto: false,
  enabled: true,
};

function draftFor(profile: AcpProfile): ProfileDraft {
  return {
    label: profile.label,
    executable: profile.executable,
    argumentsText: profile.arguments.join("\n"),
    versionArgumentsText: profile.versionArguments.join("\n"),
    modelsText: profile.models.map((model) => `${model.id} | ${model.label}`).join("\n"),
    defaultModel: profile.defaultModel,
    authMethod: profile.authMethod ?? "",
    workspace: profile.workspace ?? "",
    requireAuthentication: profile.requireAuthentication,
    fullAuto: profile.fullAuto,
    enabled: profile.enabled,
  };
}

function lines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function payloadFor(draft: ProfileDraft) {
  const models = lines(draft.modelsText).map((line) => {
    const divider = line.indexOf("|");
    const id = (divider === -1 ? line : line.slice(0, divider)).trim();
    const label = (divider === -1 ? line : line.slice(divider + 1)).trim() || id;
    return { id, label };
  });
  return {
    label: draft.label.trim(),
    executable: draft.executable.trim(),
    arguments: lines(draft.argumentsText),
    versionArguments: lines(draft.versionArgumentsText),
    models,
    defaultModel: draft.defaultModel.trim(),
    authMethod: draft.authMethod.trim() || undefined,
    workspace: draft.workspace.trim() || undefined,
    requireAuthentication: draft.requireAuthentication,
    fullAuto: draft.fullAuto,
    enabled: draft.enabled,
  };
}

const inputClass =
  "w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary/70 focus:border-accent/70 focus:outline-none";

function ToggleRow({
  checked,
  onChange,
  title,
  detail,
  danger = false,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  title: string;
  detail: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg px-1 py-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={cn(
          "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
          checked ? (danger ? "bg-warning" : "bg-accent") : "bg-raised",
        )}
      >
        <span className={cn("size-4 rounded-full bg-white transition-transform", checked && "translate-x-4")} />
      </button>
      <span>
        <span className={cn("block text-[13px] font-medium", danger ? "text-warning" : "text-ink")}>{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-secondary">{detail}</span>
      </span>
    </div>
  );
}

export function AcpProfiles() {
  const [profiles, setProfiles] = useState<AcpProfile[]>([]);
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const body = await api("/api/acp-profiles");
    setProfiles(Array.isArray(body.profiles) ? body.profiles : []);
  }, []);

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [load]);

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const startNew = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
    setEditorOpen(true);
  };

  const startEdit = (profile: AcpProfile) => {
    setEditingId(profile.id);
    setDraft(draftFor(profile));
    setError(null);
    setEditorOpen(true);
  };

  const valid = useMemo(() => {
    const payload = payloadFor(draft);
    return Boolean(payload.label && payload.executable && payload.models.length && payload.defaultModel);
  }, [draft]);

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api(editingId ? `/api/acp-profiles/${editingId}` : "/api/acp-profiles", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(payloadFor(draft)),
      });
      await load();
      closeEditor();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (confirmingDelete !== id) {
      setConfirmingDelete(id);
      return;
    }
    setError(null);
    try {
      await api(`/api/acp-profiles/${id}`, { method: "DELETE" });
      setConfirmingDelete(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="mt-4 rounded-xl bg-card p-4" aria-labelledby="acp-profiles-title">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary">
          <Terminal size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span id="acp-profiles-title" className="block text-[15px] font-medium text-ink">CLI subscriptions & ACP</span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-secondary">
            Add any local ACP-compatible CLI. Each bot can use a different subscription or model and still gets Cumea's peer-agent tools.
          </span>
        </span>
        <button
          type="button"
          onClick={editorOpen ? closeEditor : startNew}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary hover:text-ink"
          aria-label={editorOpen ? "Close ACP profile editor" : "Add ACP profile"}
        >
          {editorOpen ? <X size={16} /> : <Plus size={16} />}
        </button>
      </div>

      {profiles.length ? (
        <div className="mt-3 flex flex-col gap-2">
          {profiles.map((profile) => (
            <div key={profile.id} className="flex items-center gap-3 rounded-lg border border-hairline/35 bg-inset px-3 py-2.5">
              <span className={cn("size-2 rounded-full", profile.enabled ? "bg-success" : "bg-ink-secondary/35")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{profile.label}</span>
                <span className="block truncate text-[11.5px] text-ink-secondary">
                  {profile.executable} · {profile.models.length} model{profile.models.length === 1 ? "" : "s"}
                </span>
              </span>
              <button type="button" onClick={() => startEdit(profile)} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={`Edit ${profile.label}`}>
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => void remove(profile.id)}
                onBlur={() => confirmingDelete === profile.id && setConfirmingDelete(null)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[11.5px]",
                  confirmingDelete === profile.id ? "bg-danger/15 text-danger" : "text-ink-secondary hover:bg-raised hover:text-danger",
                )}
                aria-label={confirmingDelete === profile.id ? `Confirm deleting ${profile.label}` : `Delete ${profile.label}`}
              >
                {confirmingDelete === profile.id ? "Confirm" : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <button type="button" onClick={startNew} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-hairline/50 px-3 py-3 text-[12.5px] text-ink-secondary hover:border-hairline hover:text-ink">
          <Plus size={14} /> Add an ACP-compatible CLI
        </button>
      )}

      {editorOpen && (
        <div className="mt-4 border-t border-hairline/35 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-[12px] text-ink-secondary">Display name
              <input className={cn(inputClass, "mt-1")} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="My Claude subscription" />
            </label>
            <label className="col-span-2 text-[12px] text-ink-secondary">Executable or absolute path
              <input className={cn(inputClass, "mt-1 font-mono")} value={draft.executable} onChange={(event) => setDraft({ ...draft, executable: event.target.value })} placeholder="my-agent" spellCheck={false} />
            </label>
            <label className="col-span-2 text-[12px] text-ink-secondary">ACP arguments · one exact argument per line
              <textarea className={cn(inputClass, "mt-1 min-h-20 resize-y font-mono")} value={draft.argumentsText} onChange={(event) => setDraft({ ...draft, argumentsText: event.target.value })} placeholder={'agent\nstdio\n--model\n{model}'} spellCheck={false} />
              <span className="mt-1 block leading-relaxed">Use <code>{"{model}"}</code> where the selected model belongs. No shell parsing is used.</span>
            </label>
            <label className="col-span-2 text-[12px] text-ink-secondary">Models · <code>id | label</code>, one per line
              <textarea className={cn(inputClass, "mt-1 min-h-20 resize-y font-mono")} value={draft.modelsText} onChange={(event) => setDraft({ ...draft, modelsText: event.target.value })} spellCheck={false} />
            </label>
            <label className="text-[12px] text-ink-secondary">Default model
              <input className={cn(inputClass, "mt-1 font-mono")} value={draft.defaultModel} onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })} spellCheck={false} />
            </label>
            <label className="text-[12px] text-ink-secondary">ACP auth method (optional)
              <input className={cn(inputClass, "mt-1 font-mono")} value={draft.authMethod} onChange={(event) => setDraft({ ...draft, authMethod: event.target.value })} placeholder="cached_token" spellCheck={false} />
            </label>
            <label className="col-span-2 text-[12px] text-ink-secondary">Workspace (optional absolute path)
              <input className={cn(inputClass, "mt-1 font-mono")} value={draft.workspace} onChange={(event) => setDraft({ ...draft, workspace: event.target.value })} placeholder="/Users/you/project" spellCheck={false} />
            </label>
          </div>

          <div className="mt-3 flex flex-col gap-1">
            <ToggleRow checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} title="Enabled" detail="Shows this subscription in each bot's model picker." />
            <ToggleRow checked={draft.requireAuthentication} onChange={(requireAuthentication) => setDraft({ ...draft, requireAuthentication })} title="Require ACP authentication" detail="Fail the turn if the requested ACP auth method is unavailable. Leave off for CLIs that use an ambient terminal login." />
            <ToggleRow checked={draft.fullAuto} onChange={(fullAuto) => setDraft({ ...draft, fullAuto })} title="Always approve tool requests" detail="High trust: the ACP agent may execute offered tools without asking you." danger />
          </div>

          <div className="mt-3 rounded-lg bg-warning/[0.08] px-3 py-2 text-[11.5px] leading-relaxed text-ink-secondary">
            Sign in with the CLI itself. Do not put API keys or tokens in arguments: argv can be visible to local processes.
          </div>
          {error && <div role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={closeEditor} className="rounded-full px-3 py-1.5 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={!valid || saving} className="flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-app disabled:opacity-35">
              {saving ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" /> : <Check size={13} />}
              {editingId ? "Save profile" : "Add profile"}
            </button>
          </div>
        </div>
      )}
      {!editorOpen && error && <div role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
    </section>
  );
}
