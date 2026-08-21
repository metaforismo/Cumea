import { KeyRound, Plus, ServerCog, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { api } from "@/state/store";

export interface PublicMcpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  environmentKeys: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface SecretRow {
  id: string;
  name: string;
  value: string;
}

const newSecret = (): SecretRow => ({ id: crypto.randomUUID(), name: "", value: "" });
const fieldClass = "settings-input text-[12.5px]";

export async function fetchMcpServers(): Promise<PublicMcpServer[]> {
  const body = await api("/api/mcp-servers");
  return Array.isArray(body.servers) ? body.servers : [];
}

export function McpServers() {
  const [servers, setServers] = useState<PublicMcpServer[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [secrets, setSecrets] = useState<SecretRow[]>([newSecret()]);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setServers(await fetchMcpServers()), []);
  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [load]);

  const reset = () => {
    setName("");
    setCommand("");
    setArgsText("");
    setSecrets([newSecret()]);
    setError(null);
  };

  const environment = useMemo(() => {
    const entries = secrets
      .map((row) => [row.name.trim(), row.value] as const)
      .filter(([key, value]) => key || value);
    if (entries.some(([key, value]) => !key || !value)) return null;
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return null;
    return Object.fromEntries(entries);
  }, [secrets]);
  const valid = Boolean(name.trim() && command.trim() && environment);

  const create = async () => {
    if (!valid || !environment || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api("/api/mcp-servers", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          command: command.trim(),
          args: argsText.split("\n").map((arg) => arg.trim()).filter(Boolean),
          environment,
        }),
      });
      await load();
      reset();
      setEditorOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (server: PublicMcpServer) => {
    setError(null);
    try {
      await api(`/api/mcp-servers/${server.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const remove = async (server: PublicMcpServer) => {
    if (confirmingDelete !== server.id) {
      setConfirmingDelete(server.id);
      return;
    }
    setError(null);
    try {
      await api(`/api/mcp-servers/${server.id}`, { method: "DELETE" });
      setConfirmingDelete(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="settings-card mt-4" aria-labelledby="local-mcp-title">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary">
          <ServerCog size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span id="local-mcp-title" className="block text-[14px] font-medium text-ink">Local MCP servers</span>
          <span className="mt-1 block text-[12px] leading-5 text-ink-secondary">
            Register an exact stdio command, then assign it only to the agents that need it. Arguments are literal—not a shell command.
          </span>
        </span>
        <button
          type="button"
          onClick={() => { if (editorOpen) reset(); setEditorOpen((open) => !open); }}
          className="settings-icon-button"
          aria-label={editorOpen ? "Close MCP server form" : "Add MCP server"}
        >
          {editorOpen ? <X size={16} /> : <Plus size={16} />}
        </button>
      </div>

      {servers.length ? (
        <div className="mt-4 grid gap-2">
          {servers.map((server) => (
            <div key={server.id} className="flex items-center gap-3 rounded-xl border border-hairline/35 bg-inset px-3 py-3">
              <button
                type="button"
                role="switch"
                aria-checked={server.enabled}
                aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                onClick={() => void toggle(server)}
                className={cn("flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors", server.enabled ? "bg-accent" : "bg-raised")}
              >
                <span className={cn("size-4 rounded-full bg-white transition-transform", server.enabled && "translate-x-4")} />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{server.name}</span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-secondary">
                  {[server.command, ...server.args].join(" ")}
                </span>
                {server.environmentKeys.length ? (
                  <span className="mt-1 flex items-center gap-1 text-[10.5px] text-ink-secondary">
                    <KeyRound size={11} aria-hidden="true" /> {server.environmentKeys.join(", ")} · values hidden
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => void remove(server)}
                onBlur={() => confirmingDelete === server.id && setConfirmingDelete(null)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[11px]",
                  confirmingDelete === server.id ? "bg-danger/15 text-danger" : "text-ink-secondary hover:bg-raised hover:text-danger",
                )}
                aria-label={confirmingDelete === server.id ? `Confirm deleting ${server.name}` : `Delete ${server.name}`}
              >
                {confirmingDelete === server.id ? "Confirm" : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-hairline/40 px-4 py-3 text-[12px] text-ink-secondary">
          No local MCP server is registered.
        </p>
      )}

      {editorOpen ? (
        <div className="mt-4 grid gap-3 border-t border-hairline/35 pt-4">
          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-medium text-ink-secondary">Display name</span>
            <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Internal research tools" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-medium text-ink-secondary">Executable</span>
            <input className={cn(fieldClass, "font-mono")} value={command} onChange={(event) => setCommand(event.target.value)} placeholder="/absolute/path/to/server" spellCheck={false} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-medium text-ink-secondary">Arguments · one literal argument per line</span>
            <textarea className={cn(fieldClass, "min-h-20 resize-y font-mono")} value={argsText} onChange={(event) => setArgsText(event.target.value)} placeholder={"--transport\nstdio"} spellCheck={false} />
          </label>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11.5px] font-medium text-ink-secondary">Write-only environment</span>
              <button type="button" onClick={() => setSecrets((rows) => [...rows, newSecret()])} className="text-[11px] text-ink-secondary hover:text-ink">+ Add secret</button>
            </div>
            {secrets.map((row) => (
              <div key={row.id} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_28px] gap-2">
                <input
                  className={cn(fieldClass, "font-mono")}
                  value={row.name}
                  onChange={(event) => setSecrets((rows) => rows.map((candidate) => candidate.id === row.id ? { ...candidate, name: event.target.value } : candidate))}
                  placeholder="API_TOKEN"
                  aria-label="Environment variable name"
                  spellCheck={false}
                />
                <input
                  type="password"
                  className={cn(fieldClass, "font-mono")}
                  value={row.value}
                  onChange={(event) => setSecrets((rows) => rows.map((candidate) => candidate.id === row.id ? { ...candidate, value: event.target.value } : candidate))}
                  placeholder="Secret value"
                  aria-label={`Secret value for ${row.name || "environment variable"}`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="rounded-md text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-30"
                  disabled={secrets.length === 1}
                  onClick={() => setSecrets((rows) => rows.filter((candidate) => candidate.id !== row.id))}
                  aria-label="Remove environment variable"
                >
                  <X size={14} className="mx-auto" />
                </button>
              </div>
            ))}
            <p className="text-[10.5px] leading-4 text-ink-secondary">Secret values are encrypted by neither Cumea nor MCP. They are stored in a local mode-0600 file, never returned by the API, and passed only to this process.</p>
          </div>
          {environment === null ? <p className="text-[11px] text-danger">Every environment row needs a unique name and value.</p> : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10.5px] leading-4 text-warning">Only add executables you trust: the process runs with your local user permissions.</p>
            <button type="button" disabled={!valid || saving} onClick={() => void create()} className="settings-primary shrink-0">
              {saving ? "Adding…" : "Add server"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-[11.5px] text-danger">{error}</p> : null}
    </section>
  );
}
