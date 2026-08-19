import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";

export type PreviewFileKind = "markdown" | "pdf" | "docx";

export type DocumentBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list-item"; text: string };

export type StructuredFilePreview =
  | { kind: "markdown"; text: string }
  | { kind: "document"; blocks: DocumentBlock[]; truncated: boolean; warnings: string[] };

const MARKDOWN_MAX_BYTES = 5 * 1024 * 1024;
const DOCX_MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const DOCX_MAX_ENTRIES = 512;
const DOCX_MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const DOCX_MAX_COMPRESSION_RATIO = 100;
const DOCX_MAX_PREVIEW_CHARACTERS = 2_000_000;
const DOCX_MAX_BLOCKS = 5_000;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const ZIP_EOCD_FIXED_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATE = 8;

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  payloadOffset: number;
  directory: boolean;
}

function previewError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw previewError(415, `${label} is not valid UTF-8 text`);
  }
}

function corruptDocxArchive(): Error {
  return previewError(415, "DOCX archive central directory is corrupt");
}

function checkedAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < left) throw corruptDocxArchive();
  return value;
}

function rejectZip64Extra(bytes: Buffer, offset: number, length: number): void {
  const end = checkedAdd(offset, length);
  let cursor = offset;
  while (cursor < end) {
    if (cursor + 4 > end) throw corruptDocxArchive();
    const fieldId = bytes.readUInt16LE(cursor);
    const fieldLength = bytes.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + fieldLength > end) throw corruptDocxArchive();
    if (fieldId === ZIP64_EXTRA_FIELD) {
      throw previewError(415, "ZIP64 DOCX archives are not supported for preview");
    }
    cursor += fieldLength;
  }
}

function decodeEntryName(bytes: Buffer, flags: number): string {
  const name = flags & ZIP_FLAG_UTF8 ? decodeUtf8(bytes, "DOCX archive path") : bytes.toString("latin1");
  if (
    !name ||
    name.length > 260 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\u0000") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((part) => part === "..")
  ) {
    throw previewError(415, "DOCX contains an unsafe archive path");
  }
  return name;
}

function rejectActivePackagePart(name: string): void {
  const lower = name.toLowerCase();
  if (
    lower.includes("vbaproject") ||
    lower.startsWith("word/embeddings/") ||
    lower.startsWith("word/activex/") ||
    lower.startsWith("word/oleobject")
  ) {
    throw previewError(415, "DOCX macros and embedded active content are not previewed");
  }
}

function parseDocxArchive(bytes: Buffer): ZipEntry[] {
  if (bytes.length > DOCX_MAX_COMPRESSED_BYTES) throw previewError(413, "DOCX preview is limited to 20 MB");
  if (bytes.length < ZIP_EOCD_FIXED_BYTES) throw corruptDocxArchive();

  const searchStart = Math.max(0, bytes.length - ZIP_EOCD_FIXED_BYTES - ZIP_MAX_COMMENT_BYTES);
  let eocdOffset = -1;
  for (let offset = bytes.length - ZIP_EOCD_FIXED_BYTES; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + ZIP_EOCD_FIXED_BYTES + commentLength === bytes.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw corruptDocxArchive();

  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = bytes.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw previewError(415, "Multi-disk DOCX archives are not supported for preview");
  }
  if (
    entriesOnDisk === 0xffff ||
    totalEntries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    (eocdOffset >= 20 && bytes.readUInt32LE(eocdOffset - 20) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR)
  ) {
    throw previewError(415, "ZIP64 DOCX archives are not supported for preview");
  }
  if (totalEntries > DOCX_MAX_ENTRIES) throw previewError(413, "DOCX contains too many archive entries");

  const centralDirectoryEnd = checkedAdd(centralDirectoryOffset, centralDirectorySize);
  if (centralDirectoryOffset > eocdOffset || centralDirectoryEnd !== eocdOffset) throw corruptDocxArchive();

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let totalUncompressed = 0;
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralDirectoryEnd || bytes.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw corruptDocxArchive();
    }

    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc32 = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);

    if (flags & ZIP_FLAG_ENCRYPTED) throw previewError(415, "Encrypted DOCX archives are not previewed");
    if (flags & ZIP_FLAG_DATA_DESCRIPTOR) {
      throw previewError(415, "DOCX data-descriptor entries are not supported for preview");
    }
    if (![ZIP_METHOD_STORED, ZIP_METHOD_DEFLATE].includes(method)) {
      throw previewError(415, "DOCX uses an unsupported compression method");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw previewError(415, "ZIP64 DOCX archives are not supported for preview");
    }

    const nameOffset = cursor + 46;
    const extraOffset = checkedAdd(nameOffset, nameLength);
    const commentOffset = checkedAdd(extraOffset, extraLength);
    const recordEnd = checkedAdd(commentOffset, commentLength);
    if (recordEnd > centralDirectoryEnd) throw corruptDocxArchive();
    rejectZip64Extra(bytes, extraOffset, extraLength);

    const nameBytes = bytes.subarray(nameOffset, extraOffset);
    const name = decodeEntryName(nameBytes, flags);
    if (names.has(name)) throw previewError(415, "DOCX contains duplicate archive paths");
    names.add(name);
    rejectActivePackagePart(name);

    if (localHeaderOffset + 30 > centralDirectoryOffset || bytes.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
      throw corruptDocxArchive();
    }
    const localFlags = bytes.readUInt16LE(localHeaderOffset + 6);
    const localMethod = bytes.readUInt16LE(localHeaderOffset + 8);
    const localCrc32 = bytes.readUInt32LE(localHeaderOffset + 14);
    const localCompressedSize = bytes.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedSize = bytes.readUInt32LE(localHeaderOffset + 22);
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const localNameOffset = localHeaderOffset + 30;
    const localExtraOffset = checkedAdd(localNameOffset, localNameLength);
    const payloadOffset = checkedAdd(localExtraOffset, localExtraLength);
    const payloadEnd = checkedAdd(payloadOffset, compressedSize);
    if (payloadEnd > centralDirectoryOffset) throw corruptDocxArchive();
    rejectZip64Extra(bytes, localExtraOffset, localExtraLength);

    if (
      localFlags !== flags ||
      localMethod !== method ||
      localCrc32 !== crc32 ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      localNameLength !== nameLength ||
      !bytes.subarray(localNameOffset, localExtraOffset).equals(nameBytes)
    ) {
      throw corruptDocxArchive();
    }

    const directory = name.endsWith("/");
    if (!directory) {
      if (uncompressedSize > DOCX_MAX_ENTRY_BYTES) throw previewError(413, `${name} is too large to preview`);
      if (uncompressedSize > 0 && uncompressedSize / Math.max(1, compressedSize) > DOCX_MAX_COMPRESSION_RATIO) {
        throw previewError(413, "DOCX compression ratio exceeds the safe preview limit");
      }
      totalUncompressed = checkedAdd(totalUncompressed, uncompressedSize);
      if (totalUncompressed > DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw previewError(413, "DOCX expands beyond the safe preview limit");
      }
    }

    entries.push({
      name,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      payloadOffset,
      directory,
    });
    cursor = recordEnd;
  }

  if (cursor !== centralDirectoryEnd) throw corruptDocxArchive();
  return entries;
}

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)) >>> 0;
  return (value ^ 0xffffffff) >>> 0;
}

function inflateEntry(archive: Buffer, entry: ZipEntry, budget: { bytes: number }): Buffer {
  if (entry.directory) return Buffer.alloc(0);
  if (budget.bytes + entry.uncompressedSize > DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw previewError(413, "DOCX expands beyond the safe preview limit");
  }
  const payload = archive.subarray(entry.payloadOffset, entry.payloadOffset + entry.compressedSize);
  let output: Buffer;
  try {
    if (entry.method === ZIP_METHOD_STORED) {
      output = Buffer.from(payload);
    } else {
      output = inflateRawSync(payload, { maxOutputLength: Math.min(DOCX_MAX_ENTRY_BYTES, entry.uncompressedSize + 1) });
    }
  } catch {
    throw previewError(415, `${entry.name} is corrupt`);
  }
  if (output.length !== entry.uncompressedSize) throw previewError(415, `${entry.name} size verification failed`);
  if (crc32(output) !== entry.crc32) throw previewError(415, `${entry.name} failed CRC verification`);
  budget.bytes += output.length;
  return output;
}

function assertPassiveXml(xml: string, label: string): void {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw previewError(415, `${label} contains a forbidden XML declaration`);
  }
  if (/\bTargetMode\s*=\s*["']External["']/i.test(xml)) {
    throw previewError(415, "DOCX external relationships are not previewed");
  }
}

function readXml(
  archive: Buffer,
  byName: Map<string, ZipEntry>,
  name: string,
  budget: { bytes: number },
  required = false,
): string | null {
  const entry = byName.get(name);
  if (!entry) {
    if (required) throw previewError(415, `DOCX is missing ${name}`);
    return null;
  }
  const xml = decodeUtf8(inflateEntry(archive, entry, budget), name);
  assertPassiveXml(xml, name);
  return xml;
}

function xmlEntity(value: string): string {
  switch (value) {
    case "amp": return "&";
    case "lt": return "<";
    case "gt": return ">";
    case "quot": return '"';
    case "apos": return "'";
  }
  const numeric = value.startsWith("#x") || value.startsWith("#X")
    ? Number.parseInt(value.slice(2), 16)
    : value.startsWith("#")
      ? Number.parseInt(value.slice(1), 10)
      : Number.NaN;
  if (
    !Number.isInteger(numeric) ||
    numeric < 0 ||
    numeric > 0x10ffff ||
    (numeric >= 0xd800 && numeric <= 0xdfff) ||
    (numeric < 0x20 && ![0x09, 0x0a, 0x0d].includes(numeric))
  ) {
    throw previewError(415, "DOCX contains an invalid XML entity");
  }
  return String.fromCodePoint(numeric);
}

function decodeXmlText(value: string): string {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(value)) {
    throw previewError(415, "DOCX contains an unknown XML entity");
  }
  return value
    .replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_match, entity: string) => xmlEntity(entity))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function paragraphText(xml: string): string {
  const parts: string[] = [];
  const token = /<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>|<(?:[A-Za-z_][\w.-]*:)?(tab|br)\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml))) {
    if (match[1] !== undefined) parts.push(decodeXmlText(match[1]));
    else if (match[2].toLowerCase() === "tab") parts.push("\t");
    else parts.push("\n");
  }
  return parts.join("").replace(/[ \t]+\n/g, "\n").trim();
}

function documentBlocks(xml: string): { blocks: DocumentBlock[]; truncated: boolean } {
  if (
    !/<(?:[A-Za-z_][\w.-]*:)?document\b/i.test(xml) ||
    !/(?:schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main|purl\.oclc\.org\/ooxml\/wordprocessingml\/main)/i.test(xml)
  ) {
    throw previewError(415, "DOCX document.xml is not WordprocessingML");
  }

  const blocks: DocumentBlock[] = [];
  let characters = 0;
  let truncated = false;
  const paragraph = /<(?:[A-Za-z_][\w.-]*:)?p\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?p>/gi;
  let match: RegExpExecArray | null;
  while ((match = paragraph.exec(xml))) {
    const text = paragraphText(match[1]);
    if (!text) continue;
    if (blocks.length >= DOCX_MAX_BLOCKS || characters + text.length > DOCX_MAX_PREVIEW_CHARACTERS) {
      truncated = true;
      break;
    }
    characters += text.length;
    const style = match[1].match(
      /<(?:[A-Za-z_][\w.-]*:)?pStyle\b[^>]*\b(?:[A-Za-z_][\w.-]*:)?val\s*=\s*["'](?:Heading|heading)\s*([1-6])["']/i,
    );
    if (style) blocks.push({ type: "heading", level: Number(style[1]), text });
    else if (/<(?:[A-Za-z_][\w.-]*:)?numPr\b/i.test(match[1])) blocks.push({ type: "list-item", text });
    else blocks.push({ type: "paragraph", text });
  }
  if (!blocks.length) throw previewError(415, "DOCX contains no readable paragraphs");
  return { blocks, truncated };
}

function docxPreview(bytes: Buffer): StructuredFilePreview {
  const entries = parseDocxArchive(bytes);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const budget = { bytes: 0 };

  const contentTypes = readXml(bytes, byName, "[Content_Types].xml", budget, true);
  if (!contentTypes?.includes("wordprocessingml.document.main+xml")) {
    throw previewError(415, "ZIP file is not a standard DOCX document");
  }
  if (/macroEnabled|vbaProject|activeX|oleObject/i.test(contentTypes)) {
    throw previewError(415, "DOCX active content is not previewed");
  }

  for (const entry of entries) {
    if (entry.name.toLowerCase().endsWith(".rels")) readXml(bytes, byName, entry.name, budget, true);
  }
  const documentXml = readXml(bytes, byName, "word/document.xml", budget, true);
  const { blocks, truncated } = documentBlocks(documentXml!);
  return {
    kind: "document",
    blocks,
    truncated,
    warnings: [
      "Read-only semantic preview. Complex Word layout, images, comments, and tracked changes may be omitted.",
      ...(truncated ? ["The preview was truncated; download the original to read the rest."] : []),
    ],
  };
}

export function classifyPreviewFile(name: string, bytes: Buffer): { kind: PreviewFileKind; mime: string } {
  const extension = extname(name).toLowerCase();
  if ([".md", ".markdown", ".mdown"].includes(extension)) {
    if (bytes.length > MARKDOWN_MAX_BYTES) throw previewError(413, "Markdown preview is limited to 5 MB");
    const text = decodeUtf8(bytes, "Markdown file");
    if (text.includes("\u0000")) throw previewError(415, "Markdown file contains binary data");
    return { kind: "markdown", mime: "text/markdown; charset=utf-8" };
  }
  if (extension === ".pdf") {
    const header = bytes.subarray(0, 8).toString("ascii");
    const trailer = bytes.subarray(Math.max(0, bytes.length - 2048)).toString("latin1");
    if (!/^%PDF-[12]\.[0-9]/.test(header) || !trailer.includes("%%EOF")) {
      throw previewError(415, "file extension says PDF, but the PDF signature is invalid");
    }
    return { kind: "pdf", mime: "application/pdf" };
  }
  if (extension === ".docx") {
    if (bytes.length > DOCX_MAX_COMPRESSED_BYTES) throw previewError(413, "DOCX preview is limited to 20 MB");
    const signature = bytes.subarray(0, 4);
    const zipSignature = signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (!zipSignature) throw previewError(415, "file extension says DOCX, but the ZIP signature is invalid");
    return {
      kind: "docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  throw previewError(415, "Cumea previews Markdown, PDF, and DOCX files");
}

export function buildStructuredPreview(
  kind: Exclude<PreviewFileKind, "pdf">,
  bytes: Buffer,
): StructuredFilePreview {
  if (kind === "markdown") {
    if (bytes.length > MARKDOWN_MAX_BYTES) throw previewError(413, "Markdown preview is limited to 5 MB");
    const text = decodeUtf8(bytes, "Markdown file");
    if (text.includes("\u0000")) throw previewError(415, "Markdown file contains binary data");
    return { kind: "markdown", text };
  }
  return docxPreview(bytes);
}
