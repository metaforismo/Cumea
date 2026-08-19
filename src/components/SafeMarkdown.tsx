import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface SafeMarkdownProps {
  text: string;
  className?: string;
  onOpenFile?: (path: string) => void;
}

const FILE_EXTENSION = /\.(?:md|markdown|mdown|pdf|docx)$/i;

export function isPreviewableFileName(value: string): boolean {
  return FILE_EXTENSION.test(value.trim().split(/[?#]/, 1)[0] ?? "");
}

function safeFilePath(value: string): string | null {
  const path = value.trim();
  if (
    !path ||
    path.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    isAbsoluteLike(path) ||
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    !FILE_EXTENSION.test(path)
  ) return null;
  return path;
}

function isAbsoluteLike(path: string) {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function PathButton({ path, onOpenFile, code = false, label }: { path: string; onOpenFile: (path: string) => void; code?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onOpenFile(path)}
      className={cn(
        "inline break-all text-left text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        code && "rounded bg-inset px-1 py-px font-mono text-[0.9em]",
      )}
      title={`Open ${path}`}
    >
      {label ?? path}
    </button>
  );
}

function plainTokens(text: string, keyBase: string, onOpenFile?: (path: string) => void): ReactNode[] {
  if (!onOpenFile) return [text];
  return text.split(/(\s+)/).map((part, index) => {
    if (!part || /^\s+$/.test(part)) return part;
    const leading = part.match(/^[([{<"']+/)?.[0] ?? "";
    const trailing = part.match(/[\])}>"'.,;:!?]+$/)?.[0] ?? "";
    const candidate = part.slice(leading.length, trailing ? -trailing.length : undefined);
    const path = safeFilePath(candidate);
    if (!path) return part;
    return <span key={`${keyBase}-path-${index}`}>{leading}<PathButton path={path} onOpenFile={onOpenFile} />{trailing}</span>;
  });
}

function inline(text: string, keyBase: string, onOpenFile?: (path: string) => void): ReactNode[] {
  const output: ReactNode[] = [];
  const token = /(\[[^\]\n]{1,200}\]\([^)\n]{1,2048}\)|\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = token.exec(text))) {
    if (match.index > cursor) output.push(...plainTokens(text.slice(cursor, match.index), `${keyBase}-${index++}`, onOpenFile));
    const value = match[0];
    if (value.startsWith("[")) {
      const markdownLink = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const label = markdownLink?.[1] ?? value;
      const target = markdownLink?.[2]?.trim() ?? "";
      const path = onOpenFile ? safeFilePath(target) : null;
      if (path) output.push(<PathButton key={`${keyBase}-link-${index++}`} path={path} label={label} onOpenFile={onOpenFile!} />);
      else if (/^https:\/\/[^\s]+$/i.test(target)) {
        output.push(<a key={`${keyBase}-url-${index++}`} href={target} target="_blank" rel="noreferrer noopener" className="break-all text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">{label}</a>);
      } else output.push(value);
    } else if (value.startsWith("**")) {
      output.push(<strong key={`${keyBase}-strong-${index++}`}>{plainTokens(value.slice(2, -2), `${keyBase}-s`, onOpenFile)}</strong>);
    } else {
      const content = value.slice(1, -1);
      const path = onOpenFile ? safeFilePath(content) : null;
      output.push(path
        ? <PathButton key={`${keyBase}-file-${index++}`} path={path} onOpenFile={onOpenFile!} code />
        : <code key={`${keyBase}-code-${index++}`} className="rounded bg-inset px-1 py-px font-mono text-[0.9em]">{content}</code>);
    }
    cursor = match.index + value.length;
  }
  if (cursor < text.length) output.push(...plainTokens(text.slice(cursor), `${keyBase}-${index}`, onOpenFile));
  return output;
}

/** Deliberately small renderer: React text nodes only, never raw HTML. */
export function SafeMarkdown({ text, className, onOpenFile }: SafeMarkdownProps) {
  const rows: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let fence: { language: string; lines: string[]; start: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceStart = line.match(/^\s*```\s*([\w.+-]*)\s*$/);
    if (fenceStart) {
      if (fence) {
        rows.push(<pre key={`code-${fence.start}`} className="my-2 overflow-x-auto rounded-xl bg-inset p-3 text-[12px] leading-relaxed">{fence.language && <div className="mb-2 text-[10px] uppercase tracking-wide text-ink-secondary">{fence.language}</div>}<code>{fence.lines.join("\n")}</code></pre>);
        fence = null;
      } else fence = { language: fenceStart[1], lines: [], start: index };
      continue;
    }
    if (fence) { fence.lines.push(line); continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      rows.push(<div key={index} role="heading" aria-level={level} className={cn("mt-3 font-semibold", level === 1 ? "text-xl" : level === 2 ? "text-lg" : "text-[1em]")}>{inline(heading[2], `h${index}`, onOpenFile)}</div>);
      continue;
    }
    const bullet = line.match(/^\s*[-+*•]\s+(.*)$/);
    if (bullet) {
      rows.push(<div key={index} className="flex gap-2 pl-1"><span aria-hidden className="text-ink-secondary">•</span><span className="min-w-0">{inline(bullet[1], `b${index}`, onOpenFile)}</span></div>);
      continue;
    }
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      rows.push(<div key={index} className="flex gap-2 pl-1"><span className="text-ink-secondary">{numbered[1]}.</span><span className="min-w-0">{inline(numbered[2], `n${index}`, onOpenFile)}</span></div>);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      rows.push(<blockquote key={index} className="border-l-2 border-hairline pl-3 text-ink-secondary">{inline(quote[1], `q${index}`, onOpenFile)}</blockquote>);
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) { rows.push(<hr key={index} className="my-3 border-hairline" />); continue; }
    if (!line.trim()) rows.push(<div key={index} className="h-2.5" aria-hidden />);
    else rows.push(<div key={index}>{inline(line, `p${index}`, onOpenFile)}</div>);
  }
  if (fence) rows.push(<pre key={`code-${fence.start}`} className="my-2 overflow-x-auto rounded-xl bg-inset p-3 text-[12px] leading-relaxed"><code>{fence.lines.join("\n")}</code></pre>);
  return <div className={className}>{rows}</div>;
}
