/**
 * Pure Markdown boundary shared by the desktop and mobile renderers.
 *
 * Rendering stays platform-specific: desktop additionally resolves managed
 * workspace files, while mobile delegates safe external URLs to the OS. This
 * module only decides which external link strings are safe and makes partial
 * streaming fences deterministic.
 */

export interface MarkdownExternalLinkPolicy {
  readonly https: boolean;
  readonly mailto: boolean;
}

export const DESKTOP_MARKDOWN_LINK_POLICY: MarkdownExternalLinkPolicy = {
  https: true,
  mailto: false,
};

export const MOBILE_MARKDOWN_LINK_POLICY: MarkdownExternalLinkPolicy = {
  https: true,
  mailto: true,
};

const CONTROL_OR_DIRECTIONAL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const ENCODED_CONTROL_CHARACTER = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const SCHEME = /^([a-z][a-z\d+.-]*):/i;
const MAX_LINK_BYTES = 2_048;

/**
 * Return a trimmed external URL only when the selected platform explicitly
 * supports its scheme. Relative paths are intentionally not handled here:
 * desktop file-preview links go through its capability-scoped path policy.
 */
export function safeMarkdownExternalUrl(
  raw: string,
  policy: MarkdownExternalLinkPolicy,
): string | null {
  const value = raw.trim();
  if (
    !value ||
    value.length > MAX_LINK_BYTES ||
    utf8ByteLength(value) > MAX_LINK_BYTES ||
    CONTROL_OR_DIRECTIONAL_CHARACTER.test(value) ||
    hasDangerousPercentEncoding(value)
  ) {
    return null;
  }

  const scheme = value.match(SCHEME)?.[1]?.toLowerCase();
  if (scheme === "https" && policy.https) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  if (scheme === "mailto" && policy.mailto) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "mailto:" || !parsed.pathname.trim()) return null;
      return value;
    } catch {
      return null;
    }
  }

  return null;
}

/** Close one unfinished CommonMark backtick or tilde fence for live preview. */
export function closeUnterminatedMarkdownFence(markdown: string): string {
  let open: { marker: "`" | "~"; length: number } | null = null;

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match?.[1]) continue;
    const marker = match[1][0] as "`" | "~";
    if (!open) {
      open = { marker, length: match[1].length };
      continue;
    }
    if (marker === open.marker && match[1].length >= open.length && !match[2]?.trim()) {
      open = null;
    }
  }

  return open ? `${markdown}\n${open.marker.repeat(open.length)}` : markdown;
}

// TextEncoder exists in every supported browser, Node, Hermes and JSC. Keep
// the helper dependency-free so the shared policy remains safe to bundle.
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Inspect one decoded layer without ever returning or navigating to it.
 * This catches UTF-8 encoded C1/bidi controls and double-encoded CR/LF forms
 * such as `%250a`, whose first decode leaves another dangerous escape.
 * Malformed percent sequences fail closed because their browser/server
 * interpretation is not portable.
 */
function hasDangerousPercentEncoding(value: string): boolean {
  if (!value.includes("%")) return false;
  if (ENCODED_CONTROL_CHARACTER.test(value)) return true;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return true;
  }
  return CONTROL_OR_DIRECTIONAL_CHARACTER.test(decoded) || ENCODED_CONTROL_CHARACTER.test(decoded);
}
