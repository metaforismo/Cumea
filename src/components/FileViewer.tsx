import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, RotateCw, X } from "lucide-react";

import { SafeMarkdown } from "./SafeMarkdown";
import { PdfViewer } from "./PdfViewer";

export interface FileCapabilityView {
  token: string;
  name: string;
  mime: string;
  kind: "markdown" | "pdf" | "docx" | "html";
  size: number;
  source: "local" | "cloud";
  expiresAt: number;
}

type Preview =
  | { kind: "markdown"; text: string; truncated?: boolean }
  | { kind: "document"; blocks: Array<{ type: "heading" | "paragraph" | "list-item"; level?: number; text: string }>; truncated: boolean; warnings: string[] };

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewer({ file, onClose }: { file: FileCapabilityView; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [capabilityExpired, setCapabilityExpired] = useState(file.expiresAt <= Date.now());
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previewUrl = `/api/files/${file.token}/preview`;
  const downloadUrl = `/api/files/${file.token}/download`;

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        closeRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [onClose]);

  useEffect(() => {
    const remaining = file.expiresAt - Date.now();
    setCapabilityExpired(remaining <= 0);
    if (remaining <= 0) return;
    const timeout = window.setTimeout(() => setCapabilityExpired(true), Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [file.expiresAt, file.token]);

  useEffect(() => {
    if (file.kind === "pdf" || file.kind === "html") return;
    const controller = new AbortController();
    setPreview(null);
    setError(null);
    void fetch(previewUrl, { signal: controller.signal, credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not load this preview");
        setPreview(body.preview as Preview);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [attempt, file.kind, previewUrl]);

  return (
    <section ref={dialogRef} className="absolute inset-0 z-40 flex flex-col bg-app" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}>
      <header className="flex min-h-14 items-center gap-3 border-b border-hairline/50 px-4">
        <FileText size={18} className="shrink-0 text-ink-secondary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink">{file.name}</div>
          <div className="text-[11px] text-ink-secondary">{file.kind.toUpperCase()} · {fileSize(file.size)} · {file.source === "cloud" ? "Cloud workspace" : "Local workspace"}</div>
        </div>
        <a href={downloadUrl} download className="flex items-center gap-1.5 rounded-lg border border-hairline/50 px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised">
          <Download size={14} /> Download
        </a>
        <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink" aria-label="Close file preview"><X size={18} /></button>
      </header>

      {file.kind === "pdf" ? (
        <PdfViewer token={file.token} fileName={file.name} />
      ) : file.kind === "html" && capabilityExpired ? (
        <div className="m-auto max-w-md rounded-2xl border border-warning/30 bg-warning/10 p-5 text-center text-[13px] text-warning">
          This static preview expired. Close it and open the workspace file again to create a new capability.
        </div>
      ) : file.kind === "html" ? (
        <div className="relative min-h-0 flex-1 bg-white">
          <iframe
            src={previewUrl}
            title={`Static preview of ${file.name}`}
            // Deliberately no sandbox tokens: the frame has an opaque origin,
            // no scripts, forms, navigation, popups or downloads. Pointer and
            // keyboard interaction are disabled because this is a snapshot,
            // not a miniature browser.
            sandbox=""
            referrerPolicy="no-referrer"
            tabIndex={-1}
            aria-label={`Static, non-interactive HTML preview of ${file.name}`}
            className="pointer-events-none h-full min-h-[320px] w-full border-0 bg-white"
          />
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink/80 px-3 py-1 text-[10px] font-medium text-app shadow-sm">
            Static preview · interaction and network disabled
          </div>
        </div>
      ) : error ? (
        <div className="m-auto max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-5 text-center">
          <div className="text-[13px] text-danger">{error}</div>
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[12px] text-ink hover:bg-raised-hover"><RotateCw size={13} /> Retry</button>
        </div>
      ) : !preview ? (
        <div className="m-auto flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={16} className="motion-safe:animate-spin" /> Preparing safe preview…</div>
      ) : preview.kind === "markdown" ? (
        <article className="min-h-0 flex-1 overflow-y-auto"><SafeMarkdown text={preview.text} className="mx-auto max-w-[860px] px-8 py-10 text-[15px] leading-7 text-ink" />{preview.truncated && <div className="mx-auto mb-8 max-w-[860px] rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning">Preview truncated. Download the original to read the rest.</div>}</article>
      ) : (
        <article className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
          <div className="mx-auto max-w-[760px] rounded-2xl border border-hairline/50 bg-card px-10 py-12 shadow-sm">
            {preview.blocks.map((block, index) => block.type === "heading" ? (
              <div key={index} role="heading" aria-level={block.level ?? 2} className={(block.level ?? 2) <= 2 ? "mb-3 mt-6 text-xl font-semibold text-ink first:mt-0" : "mb-2 mt-5 text-base font-semibold text-ink"}>{block.text}</div>
            ) : block.type === "list-item" ? (
              <div key={index} className="flex gap-3 py-1 text-[15px] leading-7 text-ink"><span aria-hidden className="text-ink-secondary">•</span><span>{block.text}</span></div>
            ) : (
              <p key={index} className="mb-3 whitespace-pre-wrap text-[15px] leading-7 text-ink">{block.text}</p>
            ))}
          </div>
          {preview.warnings.map((warning) => <div key={warning} className="mx-auto mt-3 max-w-[760px] text-center text-[11px] text-ink-secondary">{warning}</div>)}
        </article>
      )}
    </section>
  );
}
