import "./document-preview.ts";

declare module "./document-preview.ts" {
  /** Binary capabilities are download-only; preview requests fail closed at runtime. */
  export function buildStructuredPreview(kind: "binary", bytes: Buffer): never;
}
