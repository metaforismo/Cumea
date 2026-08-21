import { ArchiveRestore, Download, FileArchive, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useStore } from "@/state/store";

interface Inspection {
  manifest: {
    createdAt: string;
    scope: { kind: "full" | "agent"; botIds: string[] };
    exclusions: string[];
    skippedWorkspaceFiles: number;
  };
  fileCount: number;
  expandedBytes: number;
  botCount: number;
  attachmentCount: number;
  warnings: string[];
}

interface PersistenceIssue {
  id: string;
  store: string;
  file: string;
  kind: string;
  detectedAt: number;
  bytes?: number;
  recoveryPendingRestart?: true;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function apiError(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export function BackupRestore() {
  const { state } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [exportBotId, setExportBotId] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<"export" | "inspect" | "restore" | "reset" | null>(null);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const [issues, setIssues] = useState<PersistenceIssue[]>([]);
  const [resetConfirmations, setResetConfirmations] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetch("/api/persistence/issues")
      .then(async (response) => response.ok ? response.json() as Promise<{ issues: PersistenceIssue[] }> : Promise.reject(new Error(await apiError(response))))
      .then((body) => setIssues(body.issues))
      .catch(() => {});
  }, []);

  const resetIssue = async (issue: PersistenceIssue) => {
    if (resetConfirmations[issue.id] !== issue.file) return;
    setBusy("reset");
    setError("");
    try {
      const response = await fetch(`/api/persistence/issues/${issue.id}/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: issue.file }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      setIssues((current) => current.map((candidate) => candidate.id === issue.id ? { ...candidate, recoveryPendingRestart: true } : candidate));
      window.alert("The corrupt original was preserved privately and the store was reset. Restart Cumea before continuing.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Persistence reset failed");
    } finally {
      setBusy(null);
    }
  };

  const exportBackup = async () => {
    setBusy("export");
    setError("");
    try {
      const query = exportBotId ? `?botId=${encodeURIComponent(exportBotId)}` : "";
      const response = await fetch(`/api/backup/export${query}`);
      if (!response.ok) throw new Error(await apiError(response));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? "cumea-backup.zip";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backup export failed");
    } finally {
      setBusy(null);
    }
  };

  const inspect = async (file: File) => {
    setArchive(file);
    setInspection(null);
    setConfirmation("");
    setRestored(false);
    setBusy("inspect");
    setError("");
    try {
      const response = await fetch("/api/backup/inspect", {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: file,
      });
      if (!response.ok) throw new Error(await apiError(response));
      setInspection(await response.json() as Inspection);
    } catch (cause) {
      setArchive(null);
      setError(cause instanceof Error ? cause.message : "Backup inspection failed");
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!archive || confirmation !== "RESTORE") return;
    setBusy("restore");
    setError("");
    setRestored(false);
    try {
      const response = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "content-type": "application/zip", "x-cumea-restore-confirm": "replace" },
        body: archive,
      });
      if (!response.ok) throw new Error(await apiError(response));
      setRestored(true);
      setConfirmation("");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4">
      {issues.length > 0 && (
        <div className="settings-card border-danger/35">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger"><ShieldAlert size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-ink">Persistence recovery required</div>
              <p className="mt-1 text-[12px] leading-5 text-ink-secondary">Cumea found malformed local data and blocked writes that could overwrite it. Prefer restoring a verified backup below. A reset preserves the corrupt bytes privately, creates an empty store, and requires an app restart.</p>
              {issues.map((issue) => (
                <div key={issue.id} className="mt-3 rounded-lg bg-danger/5 p-3">
                  <div className="text-[12px] font-medium text-ink">{issue.store}</div>
                  <div className="mt-1 text-[11px] text-ink-secondary">{issue.file} · {issue.kind}{issue.bytes === undefined ? "" : ` · ${formatBytes(issue.bytes)}`}</div>
                  {issue.recoveryPendingRestart && <div className="mt-2 text-[11px] font-medium text-warning">Original preserved and reset staged. Restart Cumea; writes remain blocked until then.</div>}
                  {!issue.recoveryPendingRestart && <>
                  <label className="mt-2 grid gap-1.5">
                    <span className="text-[11px] text-ink-secondary">Type <strong className="text-ink">{issue.file}</strong> only if you accept resetting this store.</span>
                    <input className="settings-input max-w-[320px]" value={resetConfirmations[issue.id] ?? ""} onChange={(event) => setResetConfirmations((current) => ({ ...current, [issue.id]: event.target.value }))} autoComplete="off" spellCheck={false} />
                  </label>
                  <button type="button" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] font-medium text-danger disabled:opacity-40" disabled={busy !== null || resetConfirmations[issue.id] !== issue.file} onClick={() => void resetIssue(issue)}>Preserve original and reset</button>
                  </>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="settings-card">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Download size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-ink">Export a portable backup</div>
            <p className="mt-1 text-[12px] leading-5 text-ink-secondary">Includes agents, conversations, tasks, routines, memory, attachments and safe workspace files. Credentials and host sessions stay behind.</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="backup-scope">Backup scope</label>
              <select id="backup-scope" value={exportBotId} onChange={(event) => setExportBotId(event.target.value)} className="settings-input min-w-[220px]">
                <option value="">Entire workspace</option>
                {state.bots.filter((bot) => !bot.hidden).map((bot) => <option key={bot.id} value={bot.id}>{bot.name} only</option>)}
              </select>
              <button type="button" className="settings-primary" disabled={busy !== null} onClick={() => void exportBackup()}>
                <Download size={14} /> {busy === "export" ? "Preparing…" : "Export ZIP"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><ArchiveRestore size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-ink">Inspect and restore</div>
            <p className="mt-1 text-[12px] leading-5 text-ink-secondary">Cumea verifies every path, size and SHA-256 digest before changing local data. Running agents must finish first.</p>
            <input ref={inputRef} type="file" accept=".zip,application/zip" className="sr-only" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void inspect(file);
              event.currentTarget.value = "";
            }} />
            <button type="button" className="mt-4 flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-raised-hover hover:text-ink disabled:opacity-40" disabled={busy !== null} onClick={() => inputRef.current?.click()}>
              <Upload size={14} /> {busy === "inspect" ? "Verifying…" : "Choose backup ZIP"}
            </button>

            {inspection ? (
              <div className="mt-4 rounded-xl border border-hairline/45 bg-raised/45 p-4">
                <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink"><ShieldCheck size={15} className="text-success" /> Integrity checks passed</div>
                <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-[11.5px] text-ink-secondary sm:grid-cols-4">
                  <span>{inspection.botCount} agent{inspection.botCount === 1 ? "" : "s"}</span>
                  <span>{inspection.attachmentCount} attachments</span>
                  <span>{inspection.fileCount} files</span>
                  <span>{formatBytes(inspection.expandedBytes)}</span>
                </div>
                <p className="mt-3 flex items-center gap-2 text-[11.5px] text-ink-secondary"><FileArchive size={13} /> {archive?.name}</p>
                {inspection.warnings.map((warning) => <p key={warning} className="mt-2 text-[11.5px] leading-4 text-warning">{warning}</p>)}
                <div className="mt-4 border-t border-hairline/35 pt-4">
                  <label className="grid gap-1.5">
                    <span className="text-[11.5px] text-ink-secondary">Type <strong className="font-semibold text-ink">RESTORE</strong> to replace the backed-up scope. A pre-restore snapshot is retained on this host.</span>
                    <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="settings-input max-w-[220px]" autoComplete="off" spellCheck={false} />
                  </label>
                  <button type="button" className="settings-primary mt-3" disabled={busy !== null || confirmation !== "RESTORE"} onClick={() => void restore()}>
                    <ArchiveRestore size={14} /> {busy === "restore" ? "Restoring…" : "Restore verified backup"}
                  </button>
                </div>
              </div>
            ) : null}
            {restored ? <p role="status" className="mt-3 text-[12px] text-success">Restore completed. Reloading the workspace…</p> : null}
            {error ? <p role="alert" className="mt-3 text-[12px] leading-5 text-danger">{error}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
