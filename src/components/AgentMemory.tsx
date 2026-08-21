import { Brain, History, Pin, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { api } from "@/state/store";

interface MemoryProvenance {
  source: "user" | "agent";
  threadId?: string;
  runId?: string;
  createdAt: number;
}

interface MemoryDocument {
  id: string;
  path: string;
  content: string;
  revision: number;
  revisionId: string;
  pinned: boolean;
  provenance: MemoryProvenance;
  usedForAnswerCount: number;
  lastUsedAt?: number;
  updatedAt: number;
}

interface MemoryRevision {
  id: string;
  revision: number;
  content: string;
  provenance: MemoryProvenance;
  usedForAnswerCount: number;
  lastUsedAt?: number;
}

const fieldClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";

export function AgentMemory({
  botId,
  agentWriteEnabled,
  canAgentWrite,
  onAgentWriteChange,
}: {
  botId: string;
  agentWriteEnabled: boolean;
  canAgentWrite: boolean;
  onAgentWriteChange(enabled: boolean): void;
}) {
  const [documents, setDocuments] = useState<MemoryDocument[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<MemoryRevision[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const body = await api(`/api/bots/${botId}/memories`);
    setDocuments(Array.isArray(body.documents) ? body.documents : []);
  }, [botId]);
  useEffect(() => {
    setEditorOpen(false);
    setHistoryId(null);
    setError(null);
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [load]);

  const resetEditor = () => {
    setEditingId(null);
    setPath("");
    setContent("");
    setPinned(false);
    setEditorOpen(false);
  };
  const edit = (document: MemoryDocument, restoredContent = document.content) => {
    setEditingId(document.id);
    setPath(document.path);
    setContent(restoredContent);
    setPinned(document.pinned);
    setEditorOpen(true);
    setHistoryId(null);
  };
  const save = async () => {
    if (!path.trim() || !content.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const current = documents.find((document) => document.id === editingId);
      await api(current ? `/api/bots/${botId}/memories/${current.id}` : `/api/bots/${botId}/memories`, {
        method: current ? "PUT" : "POST",
        body: JSON.stringify({ path, content, pinned, ...(current ? { expectedRevision: current.revision } : {}) }),
      });
      await load();
      resetEditor();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
  const togglePinned = async (document: MemoryDocument) => {
    setError(null);
    try {
      await api(`/api/bots/${botId}/memories/${document.id}`, {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: document.revision, pinned: !document.pinned }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const showHistory = async (document: MemoryDocument) => {
    if (historyId === document.id) {
      setHistoryId(null);
      return;
    }
    setError(null);
    try {
      const body = await api(`/api/bots/${botId}/memories/${document.id}/revisions`);
      setRevisions(Array.isArray(body.revisions) ? body.revisions : []);
      setHistoryId(document.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const remove = async (document: MemoryDocument) => {
    if (confirmingDelete !== document.id) {
      setConfirmingDelete(document.id);
      return;
    }
    setError(null);
    try {
      await api(`/api/bots/${botId}/memories/${document.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedRevision: document.revision }),
      });
      setConfirmingDelete(null);
      if (historyId === document.id) setHistoryId(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="rounded-xl bg-card p-4" aria-labelledby="agent-memory-title">
      <div className="flex items-start gap-3">
        <Brain size={17} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div id="agent-memory-title" className="text-[15px] font-medium text-ink">Durable memory</div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">Pinned notes are always considered; other notes are retrieved by relevance. Cumea records the exact revision only after a successful answer.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (editorOpen) resetEditor();
            else { setEditingId(null); setPath(""); setContent(""); setPinned(false); setEditorOpen(true); }
          }}
          className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
          aria-label={editorOpen ? "Close memory editor" : "Add memory"}
        >
          {editorOpen ? <X size={15} /> : <Plus size={15} />}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5">
        <span>
          <span className="block text-[11.5px] font-medium text-ink">Allow agent-initiated revisions</span>
          <span className="mt-0.5 block text-[9.5px] leading-4 text-ink-secondary">{canAgentWrite ? "Persistent writes still require the provider permission flow." : "Unavailable with this provider; manual memory remains available."}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={agentWriteEnabled}
          disabled={!canAgentWrite}
          onClick={() => onAgentWriteChange(!agentWriteEnabled)}
          className={cn("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35", agentWriteEnabled ? "bg-accent" : "bg-raised")}
          aria-label={`${agentWriteEnabled ? "Disable" : "Enable"} agent-initiated memory revisions`}
        >
          <span className={cn("absolute top-[3px] size-4 rounded-full bg-white transition-all", agentWriteEnabled ? "left-[19px]" : "left-[3px]")} />
        </button>
      </div>

      {documents.length ? (
        <div className="mt-3 grid gap-2">
          {documents.map((document) => (
            <div key={document.id} className="rounded-lg border border-hairline/35 bg-inset px-3 py-2.5">
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => void togglePinned(document)} className={cn("mt-0.5 rounded p-0.5", document.pinned ? "text-warning" : "text-ink-secondary hover:text-ink")} aria-label={`${document.pinned ? "Unpin" : "Pin"} ${document.path}`}>
                  <Pin size={13} fill={document.pinned ? "currentColor" : "none"} />
                </button>
                <button type="button" onClick={() => edit(document)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-mono text-[11.5px] font-medium text-ink">{document.path}</span>
                  <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-ink-secondary">{document.content}</span>
                  <span className="mt-1 block text-[9.5px] text-ink-secondary">revision {document.revision} · {document.provenance.source === "user" ? "added manually" : "saved by agent"} · used in {document.usedForAnswerCount} successful {document.usedForAnswerCount === 1 ? "answer" : "answers"}</span>
                </button>
                <button type="button" onClick={() => void showHistory(document)} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={`Revision history for ${document.path}`}><History size={13} /></button>
                <button
                  type="button"
                  onClick={() => void remove(document)}
                  onBlur={() => confirmingDelete === document.id && setConfirmingDelete(null)}
                  className={cn("rounded-md px-1.5 py-1 text-[10px]", confirmingDelete === document.id ? "bg-danger/15 text-danger" : "text-ink-secondary hover:bg-raised hover:text-danger")}
                  aria-label={confirmingDelete === document.id ? `Confirm deleting ${document.path}` : `Delete ${document.path}`}
                >
                  {confirmingDelete === document.id ? "Confirm" : <Trash2 size={13} />}
                </button>
              </div>
              {historyId === document.id ? (
                <div className="mt-2 grid max-h-48 gap-1.5 overflow-y-auto border-t border-hairline/30 pt-2">
                  {revisions.map((revision) => (
                    <button key={revision.id} type="button" onClick={() => edit(document, revision.content)} className="rounded-md bg-card px-2.5 py-2 text-left hover:bg-raised">
                      <span className="block text-[10px] font-medium text-ink">Revision {revision.revision} · {revision.provenance.source} · {new Date(revision.provenance.createdAt).toLocaleString()}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[10px] leading-4 text-ink-secondary">{revision.content}</span>
                    </button>
                  ))}
                  <p className="px-1 text-[9.5px] text-ink-secondary">Selecting an older version opens it for restoration as a new revision.</p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <p className="mt-3 rounded-lg border border-dashed border-hairline/40 px-3 py-3 text-[11.5px] text-ink-secondary">No durable memory yet.</p>}

      {editorOpen ? (
        <div className="mt-3 grid gap-2.5 border-t border-hairline/35 pt-3">
          <label className="grid gap-1"><span className="text-[10.5px] text-ink-secondary">Markdown path</span><input className={cn(fieldClass, "font-mono")} value={path} onChange={(event) => setPath(event.target.value)} placeholder="preferences.md" /></label>
          <label className="grid gap-1"><span className="text-[10.5px] text-ink-secondary">Memory</span><textarea className={cn(fieldClass, "min-h-28 resize-y")} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Facts or preferences worth carrying into future tasks…" /></label>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[10.5px] text-ink-secondary"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /> Always consider</label>
            <button type="button" disabled={!path.trim() || !content.trim() || saving} onClick={() => void save()} className="rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-app disabled:opacity-35">{saving ? "Saving…" : editingId ? "Save revision" : "Add memory"}</button>
          </div>
          <p className="text-[9.5px] leading-4 text-ink-secondary">Up to 100 notes, 16 KB each and 50 revisions per note. Deleting a note permanently removes its retained history. Credentials and private keys are rejected.</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-[10.5px] text-danger">{error}</p> : null}
    </section>
  );
}
