import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildStructuredPreview, classifyPreviewFile } from "./document-preview.ts";

const CONTENT_TYPES = `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

async function docx(document: string, extras: Record<string, string> = {}, compression: "STORE" | "DEFLATE" = "STORE") {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("word/document.xml", document);
  for (const [name, value] of Object.entries(extras)) zip.file(name, value);
  return zip.generateAsync({ type: "nodebuffer", compression });
}

function patchCentralUncompressedSize(bytes: Buffer, entryName: string, size: number): Buffer {
  const patched = Buffer.from(bytes);
  for (let offset = 0; offset + 46 <= patched.length; offset += 1) {
    if (patched.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = patched.readUInt16LE(offset + 28);
    const extraLength = patched.readUInt16LE(offset + 30);
    const commentLength = patched.readUInt16LE(offset + 32);
    const name = patched.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === entryName) {
      patched.writeUInt32LE(size, offset + 24);
      return patched;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  throw new Error(`missing central-directory entry ${entryName}`);
}

function mutateStoredEntry(bytes: Buffer, entryName: string, from: string, to: string): Buffer {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) throw new Error("replacement must preserve byte length");
  const mutated = Buffer.from(bytes);
  for (let offset = 0; offset + 30 <= mutated.length; offset += 1) {
    if (mutated.readUInt32LE(offset) !== 0x04034b50) continue;
    const compressedSize = mutated.readUInt32LE(offset + 18);
    const nameLength = mutated.readUInt16LE(offset + 26);
    const extraLength = mutated.readUInt16LE(offset + 28);
    const name = mutated.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const payloadOffset = offset + 30 + nameLength + extraLength;
    if (name === entryName) {
      const index = mutated.indexOf(from, payloadOffset, "utf8");
      if (index < payloadOffset || index + Buffer.byteLength(from) > payloadOffset + compressedSize) throw new Error(`missing payload text in ${entryName}`);
      mutated.write(to, index, "utf8");
      return mutated;
    }
    offset = payloadOffset + compressedSize - 1;
  }
  throw new Error(`missing local entry ${entryName}`);
}

function findEocd(bytes: Buffer): number {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    if (offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) return offset;
  }
  throw new Error("missing EOCD");
}

const documentXml = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

describe("safe document preview", () => {
  it("classifies content by extension and signature", () => {
    expect(classifyPreviewFile("report.md", Buffer.from("# Report"))).toMatchObject({ kind: "markdown" });
    expect(classifyPreviewFile("report.pdf", Buffer.from("%PDF-1.7\n1 0 obj\n%%EOF"))).toMatchObject({ kind: "pdf" });
    expect(() => classifyPreviewFile("report.pdf", Buffer.from("<script>alert(1)</script>%%EOF"))).toThrow(/signature/i);
    expect(() => classifyPreviewFile("report.html", Buffer.from("safe"))).toThrow(/Markdown, PDF, and DOCX/i);
  });

  it("extracts semantic DOCX blocks without producing HTML", async () => {
    const bytes = await docx(documentXml([
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly &amp; safe</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>First &lt;item&gt;</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>Text</w:t><w:tab/><w:t>after tab</w:t><w:br/><w:t>end</w:t></w:r></w:p>',
    ].join("")));
    expect(classifyPreviewFile("report.docx", bytes)).toMatchObject({ kind: "docx" });
    await expect(buildStructuredPreview("docx", bytes)).resolves.toMatchObject({
      kind: "document",
      blocks: [
        { type: "heading", level: 1, text: "Quarterly & safe" },
        { type: "list-item", text: "First <item>" },
        { type: "paragraph", text: "Text\tafter tab\nend" },
      ],
      truncated: false,
    });
  });

  it.each([
    ["DTD and entities", documentXml('<!DOCTYPE x [<!ENTITY exploit SYSTEM "file:///etc/passwd">]><w:p><w:r><w:t>&exploit;</w:t></w:r></w:p>'), {}],
    ["external relationships", documentXml("<w:p><w:r><w:t>Safe</w:t></w:r></w:p>"), { "word/_rels/document.xml.rels": '<Relationships><Relationship TargetMode="External" Target="https://attacker.test"/></Relationships>' }],
    ["embedded objects", documentXml("<w:p><w:r><w:t>Safe</w:t></w:r></w:p>"), { "word/embeddings/evil.bin": "payload" }],
    ["macros", documentXml("<w:p><w:r><w:t>Safe</w:t></w:r></w:p>"), { "word/vbaProject.bin": "payload" }],
  ])("rejects %s", async (_label, xml, extras) => {
    const bytes = await docx(xml as string, extras as Record<string, string>);
    await expect(buildStructuredPreview("docx", bytes)).rejects.toThrow(/forbidden|external|active|macro|embedded/i);
  });

  it("rejects highly compressed DOCX entries before rendering", async () => {
    const repeated = "A".repeat(400_000);
    const bytes = await docx(documentXml(`<w:p><w:r><w:t>${repeated}</w:t></w:r></w:p>`), {}, "DEFLATE");
    await expect(buildStructuredPreview("docx", bytes)).rejects.toThrow(/compression ratio/i);
  });

  it("rejects more than 512 central-directory entries", async () => {
    const extras: Record<string, string> = {};
    for (let index = 0; index < 511; index += 1) extras[`empty/${index}.txt`] = "";
    const bytes = await docx(documentXml("<w:p><w:r><w:t>Safe</w:t></w:r></w:p>"), extras);
    await expect(buildStructuredPreview("docx", bytes)).rejects.toMatchObject({ status: 413 });
  });

  it.each([
    ["multi-disk EOCD", (bytes: Buffer, eocd: number) => bytes.writeUInt16LE(1, eocd + 4)],
    ["ZIP64 EOCD sentinel", (bytes: Buffer, eocd: number) => bytes.writeUInt32LE(0xffffffff, eocd + 16)],
    ["out-of-bounds central-directory offset", (bytes: Buffer, eocd: number) => bytes.writeUInt32LE(eocd + 1, eocd + 16)],
    ["truncated central-directory size", (bytes: Buffer, eocd: number) => bytes.writeUInt32LE(bytes.readUInt32LE(eocd + 12) - 1, eocd + 12)],
    ["mismatched central-directory count", (bytes: Buffer, eocd: number) => {
      bytes.writeUInt16LE(bytes.readUInt16LE(eocd + 10) - 1, eocd + 8);
      bytes.writeUInt16LE(bytes.readUInt16LE(eocd + 10) - 1, eocd + 10);
    }],
  ])("rejects malformed %s", async (_label, mutate) => {
    const bytes = await docx(documentXml("<w:p><w:r><w:t>Safe</w:t></w:r></w:p>"));
    const malformed = Buffer.from(bytes);
    mutate(malformed, findEocd(malformed));
    await expect(buildStructuredPreview("docx", malformed)).rejects.toMatchObject({ status: 415 });
  });

  it("caps actual inflation when the central directory understates an entry", async () => {
    const repeated = "A".repeat(10 * 1024 * 1024);
    const bytes = await docx(documentXml(`<w:p><w:r><w:t>${repeated}</w:t></w:r></w:p>`), {}, "DEFLATE");
    const forged = patchCentralUncompressedSize(bytes, "word/document.xml", 900 * 1024);
    await expect(buildStructuredPreview("docx", forged)).rejects.toMatchObject({ status: 413 });
  });

  it("verifies the CRC of each inflated XML part", async () => {
    const bytes = await docx(documentXml("<w:p><w:r><w:t>Safe</w:t></w:r></w:p>"));
    const corrupted = mutateStoredEntry(bytes, "word/document.xml", "Safe", "Tafe");
    await expect(buildStructuredPreview("docx", corrupted)).rejects.toThrow(/CRC verification/i);
  });

  it("rejects unknown XML entities", async () => {
    const bytes = await docx(documentXml("<w:p><w:r><w:t>&copy;</w:t></w:r></w:p>"));
    await expect(buildStructuredPreview("docx", bytes)).rejects.toThrow(/unknown XML entity/i);
  });
});
