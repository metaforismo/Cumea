import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, RotateCw, X } from "lucide-react";

import { SafeMarkdown } from "./SafeMarkdown";

export interface FileCapabilityView {
  token: string;
  name: string;
  mime: string;
  kind: "markdown" | "pdf" | "docx" | "binary";
  size: number;
  source: "local" | "attachment";
  expiresAt: number;
}

type PreviewBlock = { type: "heading" | "paragraph" | "list-item"; level?: number; text: string };
export type FileStructuredPreview =
  | { kind: "markdown"; text: string }
  | { kind: "document"; blocks: PreviewBlock[]; truncated: boolean; warnings: string[] };

const MAX_MARKDOWN_PREVIEW_CHARS = 5 * 1024 * 1024;
const MAX_DOCUMENT_BLOCKS = 5_000;
const MAX_DOCUMENT_TEXT_CHARS = 2_000_000;
const MAX_WARNINGS = 32;
const MAX_WARNING_CHARS = 1_000;

function previewPayloadError(): Error {
  return new Error("The host returned an invalid file preview");
}

/** Renderer-side defense in depth for the already-bounded host projection. */
export function parseStructuredFilePreview(value: unknown): FileStructuredPreview {
  if (!value || typeof value !== "object") throw previewPayloadError();
  const preview = value as Record<string, unknown>;
  if (preview.kind === "markdown") {
    if (typeof preview.text !== "string" || preview.text.length > MAX_MARKDOWN_PREVIEW_CHARS) {
      throw previewPayloadError();
    }
    return { kind: "markdown", text: preview.text };
  }
  if (preview.kind !== "document" || !Array.isArray(preview.blocks) || preview.blocks.length > MAX_DOCUMENT_BLOCKS) {
    throw previewPayloadError();
  }
  if (typeof preview.truncated !== "boolean" || !Array.isArray(preview.warnings) || preview.warnings.length > MAX_WARNINGS) {
    throw previewPayloadError();
  }

  let characters = 0;
  const blocks: PreviewBlock[] = preview.blocks.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw previewPayloadError();
    const block = candidate as Record<string, unknown>;
    if (!["heading", "paragraph", "list-item"].includes(String(block.type)) || typeof block.text !== "string") {
      throw previewPayloadError();
    }
    characters += block.text.length;
    if (characters > MAX_DOCUMENT_TEXT_CHARS) throw previewPayloadError();
    if (block.type === "heading") {
      if (!Number.isInteger(block.level) || Number(block.level) < 1 || Number(block.level) > 9) throw previewPayloadError();
      return { type: "heading", level: Number(block.level), text: block.text };
    }
    if (block.level !== undefined) throw previewPayloadError();
    return { type: block.type as "paragraph" | "list-item", text: block.text };
  });

  const warnings = preview.warnings.map((warning) => {
    if (typeof warning !== "string" || warning.length > MAX_WARNING_CHARS) throw previewPayloadError();
    return warning;
  });
  return { kind: "document", blocks, truncated: preview.truncated, warnings };
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewer({ file, onClose }: { file: FileCapabilityView; onClose: () => void }) {
  const [preview, setPreview] = useState<FileStructuredPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previewable = file.kind === "markdown" || file.kind === "docx";
  const previewUrl = `/api/files/${file.token}/preview`;
  const downloadUrl = `/api/files/${file.token}/download`;

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
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
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;
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
    if (!previewable) return;
    const controller = new AbortController();
    setPreview(null);
    setError(null);
    void fetch(previewUrl, { signal: controller.signal, credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { error?: unknown; preview?: unknown };
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not load this preview");
        setPreview(parseStructuredFilePreview(body.preview));
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [attempt, previewable, previewUrl]);

  return (
    <section ref={dialogRef} className="absolute inset-0 z-40 flex flex-col bg-app" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}>
      <header className="flex min-h-14 items-center gap-3 border-b border-hairline/50 px-4">
        <FileText size={18} className="shrink-0 text-ink-secondary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink">{file.name}</div>
          <div className="text-[11px] text-ink-secondary">{file.kind.toUpperCase()} · {fileSize(file.size)} · {file.source === "attachment" ? "Managed attachment" : "Agent workspace"}</div>
        </div>
        <a href={downloadUrl} download className="flex items-center gap-1.5 rounded-lg border border-hairline/50 px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised">
          <Download size={14} /> Download
        </a>
        <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink" aria-label="Close file preview"><X size={18} /></button>
      </header>

      {!previewable ? (
        <div className="m-auto max-w-md px-6 text-center">
          <FileText size={32} className="mx-auto mb-3 text-ink-secondary" />
          <div className="text-[14px] font-medium text-ink">Preview not available yet</div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
            {file.kind === "pdf" ? "PDF rendering stays disabled until the bounded PDF.js worker/canvas gate is complete." : "This file type is download-only."}
          </p>
          <a href={downloadUrl} download className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[12px] font-medium text-ink hover:bg-raised-hover"><Download size={14} /> Download original</a>
        </div>
      ) : error ? (
        <div className="m-auto max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-5 text-center">
          <div className="text-[13px] text-danger">{error}</div>
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[12px] text-ink hover:bg-raised-hover"><RotateCw size={13} /> Retry</button>
        </div>
      ) : !preview ? (
        <div className="m-auto flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={16} className="motion-safe:animate-spin" /> Preparing safe preview…</div>
      ) : preview.kind === "markdown" ? (
        <article className="min-h-0 flex-1 overflow-y-auto"><SafeMarkdown text={preview.text} className="mx-auto max-w-[860px] px-8 py-10 text-[15px] leading-7 text-ink" /></article>
      ) : (
        <article className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
          <div className="mx-auto max-w-[760px] rounded-2xl border border-hairline/50 bg-card px-10 py-12 shadow-sm">
            {preview.blocks.map((block, index) => block.type === "heading" ? (
              <div key={index} role="heading" aria-level={block.level} className={(block.level ?? 2) <= 2 ? "mb-3 mt-6 text-xl font-semibold text-ink first:mt-0" : "mb-2 mt-5 text-base font-semibold text-ink"}>{block.text}</div>
            ) : block.type === "list-item" ? (
              <div key={index} className="flex gap-3 py-1 text-[15px] leading-7 text-ink"><span aria-hidden className="text-ink-secondary">•</span><span>{block.text}</span></div>
            ) : (
              <p key={index} className="mb-3 whitespace-pre-wrap text-[15px] leading-7 text-ink">{block.text}</p>
            ))}
          </div>
          {preview.truncated && <div className="mx-auto mt-3 max-w-[760px] text-center text-[11px] text-ink-secondary">Preview truncated. Download the original to read the rest.</div>}
          {preview.warnings.map((warning) => <div key={warning} className="mx-auto mt-3 max-w-[760px] text-center text-[11px] text-ink-secondary">{warning}</div>)}
        </article>
      )}
    </section>
  );
}
