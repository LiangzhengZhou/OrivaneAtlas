import {
  FileExtractionError,
  fileExtractionLimits,
} from "@arclattice/application";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { BoundedFileParser } from "./index";

const parser = new BoundedFileParser();
const types =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
function office(entries: Record<string, string>) {
  return zipSync(
    Object.fromEntries(
      Object.entries({ "[Content_Types].xml": types, ...entries }).map(
        ([name, text]) => [name, strToU8(text)],
      ),
    ),
    { level: 6 },
  );
}
it("preserves UTF-8 text, quoted tables and JSON source, rejecting malformed input", async () => {
  for (const extension of ["md", "txt", "csv", "tsv", "json"]) {
    const text =
      extension === "json" ? '{"标题":"原文","n":1}' : '第一行\n"第二行,原值"';
    expect(await parser.parse(extension, strToU8(text))).toEqual([
      {
        kind: extension === "csv" || extension === "tsv" ? "TABLE" : "TEXT",
        locator: "text:1",
        text,
      },
    ]);
  }
  await expect(parser.parse("txt", new Uint8Array([0xff]))).rejects.toThrow(
    "MALFORMED",
  );
  await expect(parser.parse("json", strToU8('{"bad":}'))).rejects.toThrow(
    "MALFORMED",
  );
  await expect(parser.parse("zip", strToU8("unknown"))).rejects.toThrow(
    "UNSUPPORTED",
  );
});
it("extracts DOCX paragraphs without modifying original bytes", async () => {
  const bytes = office({
    "word/document.xml":
      '<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>第一行 &amp; text</w:t></w:r></w:p><w:p><w:r><w:t>第二行</w:t></w:r></w:p></w:body></w:document>',
  });
  const original = bytes.slice();
  expect(await parser.parse("docx", bytes)).toEqual([
    { kind: "TEXT", locator: "document:1", text: "第一行 & text\n第二行" },
  ]);
  expect(bytes).toEqual(original);
});
it("extracts workbook order, shared strings and cached formulas without evaluating formulas", async () => {
  const bytes = office({
    "xl/workbook.xml":
      '<workbook xmlns:r="rel"><sheets><sheet name="数据" sheetId="1" r:id="rId7"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId7" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>原值</t></si></sst>",
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>WEBSERVICE("http://invalid.test")</f><v>42</v></c><c r="C1" t="inlineStr"><is><t>末列</t></is></c></row></sheetData></worksheet>',
  });
  expect(await parser.parse("xlsx", bytes)).toEqual([
    {
      kind: "SHEET",
      locator: "sheet:1",
      title: "数据",
      text: "原值\t42\t末列",
    },
  ]);
});
it("uses presentation relationships and slide order instead of filename order", async () => {
  const bytes = office({
    "ppt/presentation.xml":
      '<p:presentation xmlns:p="ppt" xmlns:r="rel"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
    "ppt/_rels/presentation.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
    "ppt/slides/slide1.xml":
      '<p:sld xmlns:p="ppt" xmlns:a="a"><a:p><a:r><a:t>最后</a:t></a:r></a:p></p:sld>',
    "ppt/slides/slide2.xml":
      '<p:sld xmlns:p="ppt" xmlns:a="a"><a:p><a:r><a:t>首先</a:t></a:r></a:p></p:sld>',
  });
  expect(await parser.parse("pptx", bytes)).toEqual([
    { kind: "SLIDE", locator: "slide:1", text: "首先" },
    { kind: "SLIDE", locator: "slide:2", text: "最后" },
  ]);
});
it("rejects traversal, macros, entities, deep XML and corrupt archives", async () => {
  for (const entries of [
    { "../bad.xml": "<bad/>" },
    { "C:/bad.xml": "<bad/>" },
    { "word/vbaProject.bin": "macro" },
    {
      "word/document.xml":
        '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><x>&e;</x>',
    },
  ])
    await expect(parser.parse("docx", office(entries))).rejects.toThrow(
      "UNSAFE_CONTENT",
    );
  await expect(
    parser.parse(
      "docx",
      office({ "word/document.xml": "<x>".repeat(65) + "</x>".repeat(65) }),
    ),
  ).rejects.toThrow("RESOURCE_LIMIT");
  await expect(
    parser.parse("docx", new Uint8Array([0x50, 0x4b, 3, 4])),
  ).rejects.toThrow("MALFORMED");
  await expect(
    parser.parse("txt", new Uint8Array(fileExtractionLimits.inputBytes + 1)),
  ).rejects.toThrow("RESOURCE_LIMIT");
  const abort = new AbortController();
  abort.abort();
  await expect(
    parser.parse("txt", strToU8("text"), abort.signal),
  ).rejects.toBeInstanceOf(FileExtractionError);
});
function minimalPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const content = "BT /F1 12 Tf 10 100 Td (Original PDF text) Tj ET";
  objects.push(
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  );
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return strToU8(text);
}
it("extracts real PDF page text and rejects malformed PDF without replacing source", async () => {
  const bytes = minimalPdf(),
    copy = bytes.slice();
  const sections = await parser.parse("pdf", bytes);
  expect(sections).toHaveLength(1);
  expect(sections[0]).toMatchObject({ kind: "PAGE", locator: "page:1" });
  expect(sections[0]?.text).toContain("Original PDF text");
  expect(bytes).toEqual(copy);
  await expect(parser.parse("pdf", strToU8("%PDF-invalid"))).rejects.toThrow(
    "MALFORMED",
  );
});
it("preserves sparse XLSX columns and bounds padding before allocation", async () => {
  const workbook = (rows: string) =>
    office({
      "xl/workbook.xml":
        '<workbook xmlns:r="rel"><sheets><sheet name="Sparse" r:id="sheet"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>',
      "xl/worksheets/sheet.xml": `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    });
  const bytes = workbook(
    '<row r="1"><c r="C1"><v>first</v></c><c r="F1"><v>last</v></c></row>',
  );
  expect((await parser.parse("xlsx", bytes))[0]?.text).toBe(
    "\t\tfirst\t\t\tlast",
  );
  await expect(
    parser.parse(
      "xlsx",
      workbook(
        '<row r="1"><c r="C1"><v>first</v></c><c r="B1"><v>backwards</v></c></row>',
      ),
    ),
  ).rejects.toThrow("MALFORMED");
  const sparse = Array.from(
    { length: 150 },
    (_, i) => `<row r="${i + 1}"><c r="XFD${i + 1}"><v>x</v></c></row>`,
  ).join("");
  await expect(parser.parse("xlsx", workbook(sparse))).rejects.toThrow(
    "RESOURCE_LIMIT",
  );
});
it("rejects duplicate internal relationships rather than choosing an arbitrary target", async () => {
  await expect(
    parser.parse(
      "pptx",
      office({
        "ppt/presentation.xml":
          '<p:presentation xmlns:p="ppt" xmlns:r="rel"><p:sldIdLst><p:sldId r:id="same"/></p:sldIdLst></p:presentation>',
        "ppt/_rels/presentation.xml.rels":
          '<Relationships><Relationship Id="same" Target="slides/one.xml"/><Relationship Id="same" Target="slides/two.xml"/></Relationships>',
        "ppt/slides/one.xml": '<p:sld xmlns:p="ppt"/>',
        "ppt/slides/two.xml": '<p:sld xmlns:p="ppt"/>',
      }),
    ),
  ).rejects.toThrow("MALFORMED");
});

it("rejects encrypted archives, mismatched local sizes and forged CRC before returning text", async () => {
  for (const mode of ["encrypted", "local-size", "crc"] as const) {
    const bytes = office({
      "word/document.xml": "<document><p>Original</p></document>",
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.length - 22;
    const central = view.getUint32(end + 16, true);
    const local = view.getUint32(central + 42, true);
    if (mode === "encrypted")
      view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
    if (mode === "local-size")
      view.setUint32(local + 22, view.getUint32(local + 22, true) + 1, true);
    if (mode === "crc") {
      const forged = (view.getUint32(central + 16, true) ^ 1) >>> 0;
      view.setUint32(central + 16, forged, true);
      view.setUint32(local + 14, forged, true);
    }
    await expect(parser.parse("docx", bytes)).rejects.toThrow(
      mode === "encrypted" ? "ENCRYPTED" : "MALFORMED",
    );
  }
});

it("bounds DOCX extracted text before returning a worker result", async () => {
  const text = "x".repeat(fileExtractionLimits.characters + 1);
  const bytes = office({
    "word/document.xml": "<document><p><t>" + text + "</t></p></document>",
  });
  const original = bytes.slice();
  await expect(parser.parse("docx", bytes)).rejects.toThrow("RESOURCE_LIMIT");
  expect(bytes).toEqual(original);
});
