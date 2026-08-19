import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildStructuredPreview, classifyPreviewFile } from "./document-preview.ts";

type ZipEntryFixture = {
  name: string;
  data?: Buffer | string;
  method?: 0 | 8;
  flags?: number;
  crcOverride?: number;
  localMethod?: 0 | 8;
};

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

function makeZip(entries: ZipEntryFixture[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;

  for (const fixture of entries) {
    const name = Buffer.from(fixture.name, "utf8");
    const data = Buffer.isBuffer(fixture.data) ? fixture.data : Buffer.from(fixture.data ?? "", "utf8");
    const method = fixture.method ?? 8;
    const flags = (fixture.flags ?? 0) | 0x0800;
    const payload = method === 8 ? deflateRawSync(data) : Buffer.from(data);
    const checksum = fixture.crcOverride ?? crc32(data);

    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(fixture.localMethod ?? method, 8);
    localHeader.writeUInt32LE(checksum >>> 0, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    name.copy(localHeader, 30);
    locals.push(localHeader, payload);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum >>> 0, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centrals.push(central);

    localOffset += localHeader.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Item</w:t></w:r></w:p>
    <w:p><w:r><w:t>A &amp; B</w:t></w:r><w:tab/><w:r><w:t>C</w:t></w:r></w:p>
  </w:body>
</w:document>`;

function docx(overrides: ZipEntryFixture[] = []): Buffer {
  return makeZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "word/document.xml", data: documentXml },
    ...overrides,
  ]);
}

describe("document preview format classification", () => {
  it("recognizes bounded Markdown, PDF and DOCX signatures", () => {
    expect(classifyPreviewFile("notes.md", Buffer.from("# hi"))).toMatchObject({ kind: "markdown" });
    expect(classifyPreviewFile("paper.pdf", Buffer.from("%PDF-1.7\nbody\n%%EOF"))).toMatchObject({ kind: "pdf" });
    expect(classifyPreviewFile("report.docx", docx())).toMatchObject({ kind: "docx" });
  });

  it("fails closed on spoofed or unsupported preview types", () => {
    expect(() => classifyPreviewFile("fake.pdf", Buffer.from("<html>%%EOF"))).toThrow(/signature/i);
    expect(() => classifyPreviewFile("fake.docx", Buffer.from("not zip"))).toThrow(/ZIP signature/i);
    expect(() => classifyPreviewFile("script.html", Buffer.from("<script/>"))).toThrow(/Markdown, PDF, and DOCX/i);
  });

  it("requires Markdown to be bounded UTF-8 text", () => {
    expect(() => classifyPreviewFile("bad.md", Buffer.from([0xff, 0xfe]))).toThrow(/UTF-8/i);
    expect(() => classifyPreviewFile("nul.md", Buffer.from("hello\u0000world"))).toThrow(/binary data/i);
    expect(() => classifyPreviewFile("huge.md", Buffer.alloc(5 * 1024 * 1024 + 1, 0x61))).toThrow(/5 MB/i);
  });
});

describe("bounded semantic DOCX preview", () => {
  it("extracts headings, list items, paragraphs, entities and tabs without rendering package HTML", () => {
    const preview = buildStructuredPreview("docx", docx());
    expect(preview.kind).toBe("document");
    if (preview.kind !== "document") throw new Error("wrong preview kind");
    expect(preview.blocks).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "list-item", text: "Item" },
      { type: "paragraph", text: "A & B\tC" },
    ]);
    expect(preview.truncated).toBe(false);
    expect(preview.warnings[0]).toMatch(/Read-only semantic preview/);
  });

  it("supports both stored and deflated critical XML entries", () => {
    const archive = makeZip([
      { name: "[Content_Types].xml", data: contentTypes, method: 0 },
      { name: "word/document.xml", data: documentXml, method: 8 },
    ]);
    expect(buildStructuredPreview("docx", archive)).toMatchObject({ kind: "document", truncated: false });
  });

  it("rejects external relationships before showing document content", () => {
    const relationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="https://example.com/payload" TargetMode="External"/></Relationships>`;
    expect(() => buildStructuredPreview("docx", docx([
      { name: "word/_rels/document.xml.rels", data: relationships },
    ]))).toThrow(/external relationships/i);
  });

  it("rejects DOCTYPE/entity declarations and unknown entities", () => {
    const withDoctype = documentXml.replace("<w:document", '<!DOCTYPE w:document [<!ENTITY xxe "nope">]><w:document');
    expect(() => buildStructuredPreview("docx", makeZip([
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "word/document.xml", data: withDoctype },
    ]))).toThrow(/forbidden XML declaration/i);

    const unknownEntity = documentXml.replace("Title", "A &writer;");
    expect(() => buildStructuredPreview("docx", makeZip([
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "word/document.xml", data: unknownEntity },
    ]))).toThrow(/unknown XML entity/i);
  });

  it("rejects unsafe paths, duplicate entries, active content and encrypted/data-descriptor archives", () => {
    expect(() => buildStructuredPreview("docx", docx([{ name: "../escape.xml", data: "x" }]))).toThrow(/unsafe archive path/i);
    expect(() => buildStructuredPreview("docx", docx([{ name: "word/document.xml", data: documentXml }]))).toThrow(/duplicate archive paths/i);
    expect(() => buildStructuredPreview("docx", docx([{ name: "word/embeddings/object.bin", data: "x" }]))).toThrow(/active content/i);

    expect(() => buildStructuredPreview("docx", makeZip([
      { name: "[Content_Types].xml", data: contentTypes, flags: 0x0001 },
      { name: "word/document.xml", data: documentXml },
    ]))).toThrow(/Encrypted/i);
    expect(() => buildStructuredPreview("docx", makeZip([
      { name: "[Content_Types].xml", data: contentTypes, flags: 0x0008 },
      { name: "word/document.xml", data: documentXml },
    ]))).toThrow(/data-descriptor/i);
  });

  it("rejects unsupported compression, local/central mismatches and CRC failure", () => {
    const unsupported = makeZip([
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "word/document.xml", data: documentXml },
    ]);
    const centralOffset = unsupported.readUInt32LE(unsupported.length - 6);
    unsupported.writeUInt16LE(99, centralOffset + 10);
    unsupported.writeUInt16LE(99, 8);
    expect(() => buildStructuredPreview("docx", unsupported)).toThrow(/unsupported compression/i);

    expect(() => buildStructuredPreview("docx", makeZip([
      { name: "[Content_Types].xml", data: contentTypes, localMethod: 0 },
      { name: "word/document.xml", data: documentXml },
    ]))).toThrow(/central directory is corrupt/i);

    const checksum = crc32(Buffer.from(contentTypes)) ^ 1;
    expect(() => buildStructuredPreview("docx", makeZip([
      { name: "[Content_Types].xml", data: contentTypes, crcOverride: checksum },
      { name: "word/document.xml", data: documentXml },
    ]))).toThrow(/CRC verification/i);
  });

  it("rejects compression bombs and excessive archive entry counts before semantic parsing", () => {
    expect(() => buildStructuredPreview("docx", docx([
      { name: "word/styles.xml", data: Buffer.alloc(1024 * 1024, 0x61), method: 8 },
    ]))).toThrow(/compression ratio/i);

    const many = Array.from({ length: 513 }, (_, index) => ({ name: `extra/${index}.xml`, data: "" }));
    expect(() => buildStructuredPreview("docx", makeZip(many))).toThrow(/too many archive entries/i);
  });

  it("rejects ZIP64 sentinel metadata", () => {
    const archive = docx();
    archive.writeUInt16LE(0xffff, archive.length - 12);
    archive.writeUInt16LE(0xffff, archive.length - 14);
    expect(() => buildStructuredPreview("docx", archive)).toThrow(/ZIP64/i);
  });

  it("truncates semantic output deterministically before mounting thousands of blocks", () => {
    const paragraphs = Array.from({ length: 5_001 }, (_, index) => `<w:p><w:r><w:t>P${index}</w:t></w:r></w:p>`).join("");
    const largeDocument = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`;
    const preview = buildStructuredPreview("docx", makeZip([
      { name: "[Content_Types].xml", data: contentTypes, method: 0 },
      { name: "word/document.xml", data: largeDocument, method: 0 },
    ]));
    expect(preview.kind).toBe("document");
    if (preview.kind !== "document") throw new Error("wrong preview kind");
    expect(preview.blocks).toHaveLength(5_000);
    expect(preview.truncated).toBe(true);
    expect(preview.warnings.at(-1)).toMatch(/truncated/i);
  });

  it("returns Markdown as inert text data, not pre-rendered HTML", () => {
    const preview = buildStructuredPreview("markdown", Buffer.from("# title\n<script>alert(1)</script>"));
    expect(preview).toEqual({ kind: "markdown", text: "# title\n<script>alert(1)</script>" });
  });
});
