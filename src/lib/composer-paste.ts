export const LONG_PASTE_CHARACTER_THRESHOLD = 900;
export const LONG_PASTE_LINE_THRESHOLD = 12;
export const LONG_PASTE_MAX_BYTES = 5 * 1024 * 1024;

export function shouldAttachPastedText(text: string): boolean {
  if (!text) return false;
  return text.length > LONG_PASTE_CHARACTER_THRESHOLD || text.split(/\r?\n/).length > LONG_PASTE_LINE_THRESHOLD;
}

export function pastedTextBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function pastedTextFile(text: string, ordinal: number): File {
  const suffix = ordinal > 1 ? `-${ordinal}` : "";
  return new File([text], `pasted-text${suffix}.txt`, { type: "text/plain;charset=utf-8" });
}
