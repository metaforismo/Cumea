import { useEffect, useMemo, useRef, useState } from "react";
import { api, useStore } from "@/state/store";

interface SkillManifest {
  schemaVersion: 1;
  id: string;
  displayName: string;
  description: string;
  version: string;
  contentSha256: string;
  provenance: { kind: "local-unsigned"; source: "editor" | "package-import"; label: string };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

const emptyDraft = { id: "", displayName: "", description: "", version: "1.0.0", instructions: "", label: "Created in Cumea", enabled: true };

export function LocalSkills({ botId }: { botId?: string }) {
  const { state, dispatch } = useStore();
  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
  const groups = useMemo(() => [...new Set(skills.map((skill) => skill.id))].map((id) => ({ id, versions: skills.filter((skill) => skill.id === id) })), [skills]);

  const refresh = async () => setSkills(((await api("/api/skills")).skills ?? []) as SkillManifest[]);
  useEffect(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const syncBot = (value: unknown) => {
    const result = value as { bot?: typeof bot };
    if (result.bot) dispatch({ type: "botPatched", bot: result.bot });
  };

  if (botId && !bot) return null;
  if (bot) return (
    <section className="mt-5 rounded-xl border border-hairline/40 bg-card p-4" aria-labelledby="agent-skills-title">
      <div id="agent-skills-title" className="text-[14px] font-medium text-ink">Local skills</div>
      <p className="mt-1 text-[12px] leading-5 text-ink-secondary">Only an explicitly assigned, enabled version enters this agent's prompt. Package text is unsigned workflow data, not trusted code.</p>
      {groups.length ? <div className="mt-3 grid gap-2">{groups.map(({ id, versions }) => {
        const assigned = bot.skillAssignments?.find((assignment) => assignment.id === id);
        const available = versions.filter((version) => version.enabled);
        const assignedIndex = available.findIndex((version) => version.version === assigned?.version);
        const rollbackVersion = assignedIndex >= 0 ? available.slice(assignedIndex + 1)[0]?.version : undefined;
        return <div key={id} className="rounded-lg bg-inset p-3">
          <div className="flex items-center justify-between gap-3"><div><div className="text-[13px] font-medium text-ink">{versions[0]?.displayName}</div><div className="text-[11px] text-ink-secondary">{assigned ? `Assigned ${assigned.version}` : "Not assigned"}</div></div>
            {assigned ? <button type="button" disabled={busy} className="settings-secondary" onClick={() => void run(async () => syncBot(await api(`/api/bots/${bot.id}/skills/${id}`, { method: "DELETE" })))}>Unassign</button> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label={`Version for ${versions[0]?.displayName}`} className="settings-input max-w-40" value={assigned?.version ?? ""} onChange={(event) => {
              const version = event.target.value; if (!version) return;
              void run(async () => syncBot(await api(`/api/bots/${bot.id}/skills/${id}`, { method: "PUT", body: JSON.stringify({ version }) })));
            }}><option value="">Choose version</option>{available.map((version) => <option key={version.version} value={version.version}>{version.version}</option>)}</select>
            {assigned && rollbackVersion ? <button type="button" disabled={busy} className="settings-secondary" onClick={() => {
              void run(async () => syncBot(await api(`/api/bots/${bot.id}/skills/${id}/rollback`, { method: "POST", body: JSON.stringify({ version: rollbackVersion }) })));
            }}>Rollback…</button> : null}
          </div>
        </div>;
      })}</div> : <p className="mt-3 text-[12px] text-ink-secondary">No local skill packages yet. Create one in Cumea Settings.</p>}
      {error ? <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p> : null}
    </section>
  );

  return <section className="settings-card mt-4" aria-labelledby="local-skills-title">
    <div className="flex items-start justify-between gap-3"><div><div id="local-skills-title" className="text-[14px] font-medium text-ink">Reusable local skills</div><p className="mt-1 text-[12px] leading-5 text-ink-secondary">Instruction-only packages. No scripts, hooks, binaries, assets, network installation or automatic execution. All packages are visibly local-unsigned.</p></div>
      <button type="button" className="settings-secondary" onClick={() => importRef.current?.click()}>Import JSON</button>
      <input ref={importRef} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void run(async () => api("/api/skills/import", { method: "POST", body: await file.text() })); event.currentTarget.value = ""; }} />
    </div>
    <form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); void run(async () => {
      const exists = skills.some((skill) => skill.id === draft.id);
      await api(exists ? `/api/skills/${draft.id}/versions` : "/api/skills", { method: "POST", body: JSON.stringify(draft) });
      setDraft(emptyDraft);
    }); }}>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-[12px] text-ink-secondary">Stable id<input required pattern="[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?" value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} className="settings-input" /></label><label className="grid gap-1 text-[12px] text-ink-secondary">SemVer<input required value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} className="settings-input" /></label></div>
      <label className="grid gap-1 text-[12px] text-ink-secondary">Display name<input required value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} className="settings-input" /></label>
      <label className="grid gap-1 text-[12px] text-ink-secondary">Description<input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="settings-input" /></label>
      <label className="grid gap-1 text-[12px] text-ink-secondary">Instructions<textarea required rows={5} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} className="settings-input resize-y" /></label>
      <div><button type="submit" disabled={busy} className="settings-primary">{skills.some((skill) => skill.id === draft.id) ? "Create explicit update" : "Create local skill"}</button></div>
    </form>
    {error ? <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p> : null}
    <div className="mt-4 grid gap-2">{skills.map((skill) => <div key={`${skill.id}@${skill.version}`} className="rounded-lg bg-inset p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[13px] font-medium text-ink">{skill.displayName} <span className="font-normal text-ink-secondary">v{skill.version}</span></div><div className="text-[11px] text-ink-secondary">local-unsigned · {skill.enabled ? "enabled" : "disabled"} · {skill.provenance.label}</div></div><div className="flex gap-2">
        <button type="button" disabled={busy} className="settings-secondary" onClick={() => void run(async () => api(`/api/skills/${skill.id}/${skill.version}`, { method: "PATCH", body: JSON.stringify({ enabled: !skill.enabled }) }))}>{skill.enabled ? "Disable" : "Enable"}</button>
        <button type="button" disabled={busy} className="settings-secondary" onClick={() => {
          if (!window.confirm(`Delete ${skill.id}@${skill.version}? This immutable local version cannot be recovered unless it exists in a backup.`)) return;
          void run(async () => api(`/api/skills/${skill.id}/${skill.version}`, { method: "DELETE" }));
        }}>Delete</button>
      </div></div>
    </div>)}</div>
  </section>;
}
