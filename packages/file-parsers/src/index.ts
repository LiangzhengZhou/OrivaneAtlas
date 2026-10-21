import {
  FileExtractionError,
  type FileParser,
  type FileParserSection,
  fileExtractionLimits,
} from "@arclattice/application";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { officeArchive } from "./zip";

type Node = Record<string, unknown>;
const object = (value: unknown): Node =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Node)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
function decode(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FileExtractionError("MALFORMED");
  }
}
function xml(bytes: Uint8Array) {
  if (bytes.length > fileExtractionLimits.xmlBytes)
    throw new FileExtractionError("RESOURCE_LIMIT");
  const text = decode(bytes);
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(text))
    throw new FileExtractionError("UNSAFE_CONTENT");
  let depth = 0,
    nodes = 0;
  for (const token of text.matchAll(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>/g,
  )) {
    const tag = token[0];
    if (tag.startsWith("<!") || tag.startsWith("<?")) continue;
    if (tag.startsWith("</")) depth--;
    else {
      nodes++;
      if (!tag.endsWith("/>")) depth++;
    }
    if (
      depth > fileExtractionLimits.xmlDepth ||
      nodes > fileExtractionLimits.xmlNodes
    )
      throw new FileExtractionError("RESOURCE_LIMIT");
    if (depth < 0) throw new FileExtractionError("MALFORMED");
  }
  if (depth !== 0 || XMLValidator.validate(text) !== true)
    throw new FileExtractionError("MALFORMED");
  const parsed: unknown = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    removeNSPrefix: false,
    transformTagName: (name) => name.split(":").at(-1)!,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: false,
  }).parse(text);
  return array(parsed);
}
function nodes(tree: readonly unknown[], name: string): Node[] {
  const result: Node[] = [];
  const visit = (input: readonly unknown[], depth: number) => {
    if (depth > fileExtractionLimits.xmlDepth)
      throw new FileExtractionError("RESOURCE_LIMIT");
    for (const value of input) {
      const node = object(value);
      if (Object.hasOwn(node, name)) result.push(node);
      for (const [key, children] of Object.entries(node))
        if (key !== ":@") visit(array(children), depth + 1);
    }
  };
  visit(tree, 0);
  return result;
}
function entities(text: string) {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      const known: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      if (known[entity]) return known[entity];
      const n = entity.startsWith("&#x")
        ? Number.parseInt(entity.slice(3, -1), 16)
        : Number.parseInt(entity.slice(2, -1), 10);
      if (
        !Number.isSafeInteger(n) ||
        n <= 0 ||
        n > 0x10ffff ||
        (n >= 0xd800 && n <= 0xdfff)
      )
        throw new FileExtractionError("MALFORMED");
      return String.fromCodePoint(n);
    },
  );
}
function textNodes(tree: readonly unknown[], name = "t") {
  return nodes(tree, name)
    .map((node) =>
      array(node[name])
        .map((child) => {
          const value = object(child)["#text"];
          return typeof value === "string" ? entities(value) : "";
        })
        .join(""),
    )
    .join("");
}
function paragraphText(
  tree: readonly unknown[],
  budget = fileExtractionLimits.characters,
) {
  const paragraphs: string[] = [];
  let length = 0;
  for (const node of nodes(tree, "p")) {
    const text = textNodes(array(node.p));
    length += text.length + (paragraphs.length ? 1 : 0);
    if (length > budget) throw new FileExtractionError("RESOURCE_LIMIT");
    paragraphs.push(text);
  }
  return paragraphs.join("\n");
}
function attrs(node: Node) {
  return object(node[":@"]);
}
function archive(bytes: Uint8Array) {
  const files = officeArchive(bytes);
  if (/macroEnabled|vbaProject/i.test(decode(files["[Content_Types].xml"]!)))
    throw new FileExtractionError("UNSAFE_CONTENT");
  xml(files["[Content_Types].xml"]!);
  return files;
}
function member(files: Record<string, Uint8Array>, name: string) {
  const bytes = files[name];
  if (!bytes) throw new FileExtractionError("MALFORMED");
  return xml(bytes);
}
function relationships(
  files: Record<string, Uint8Array>,
  path: string,
  root: string,
) {
  const mapping = new Map<string, string>();
  for (const node of nodes(member(files, path), "Relationship")) {
    const a = attrs(node),
      id = a["@_Id"],
      target = a["@_Target"];
    if (a["@_TargetMode"] === "External") continue;
    if (
      typeof id !== "string" ||
      typeof target !== "string" ||
      target.includes("\\") ||
      target.includes(":") ||
      target.split("/").includes("..")
    )
      throw new FileExtractionError("UNSAFE_CONTENT");
    if (mapping.has(id)) throw new FileExtractionError("MALFORMED");
    mapping.set(
      id,
      target.startsWith("/") ? target.slice(1) : `${root}/${target}`,
    );
  }
  return mapping;
}
async function pdf(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<FileParserSection[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: bytes.slice(),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: true,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    verbosity: 0,
  });
  const cancel = () => {
    void task.destroy();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const document = await task.promise;
    if (document.numPages > fileExtractionLimits.sections)
      throw new FileExtractionError("RESOURCE_LIMIT");
    const result: FileParserSection[] = [];
    let characters = 0;
    for (let i = 1; i <= document.numPages; i++) {
      if (signal?.aborted) throw new FileExtractionError("CANCELED");
      const page = await document.getPage(i),
        content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("");
      if ((characters += text.length) > fileExtractionLimits.characters)
        throw new FileExtractionError("RESOURCE_LIMIT");
      result.push({ kind: "PAGE", locator: `page:${i}`, text });
      page.cleanup();
    }
    return result;
  } catch (error) {
    if (error instanceof FileExtractionError) throw error;
    if (signal?.aborted) throw new FileExtractionError("CANCELED");
    if (error instanceof Error && error.name === "PasswordException")
      throw new FileExtractionError("ENCRYPTED");
    throw new FileExtractionError("MALFORMED");
  } finally {
    signal?.removeEventListener("abort", cancel);
    await task.destroy();
  }
}

/** Runs in an isolated worker in product wiring. No macros, network or AI. */
export class BoundedFileParser implements FileParser {
  async parse(
    extension: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<readonly FileParserSection[]> {
    if (signal?.aborted) throw new FileExtractionError("CANCELED");
    if (bytes.length > fileExtractionLimits.inputBytes)
      throw new FileExtractionError("RESOURCE_LIMIT");
    if (["md", "txt", "csv", "tsv", "json"].includes(extension)) {
      const text = decode(bytes);
      if (text.length > fileExtractionLimits.characters)
        throw new FileExtractionError("RESOURCE_LIMIT");
      if (extension === "json") {
        try {
          JSON.parse(text);
        } catch {
          throw new FileExtractionError("MALFORMED");
        }
      }
      return [
        {
          kind: extension === "csv" || extension === "tsv" ? "TABLE" : "TEXT",
          locator: "text:1",
          text,
        },
      ];
    }
    if (extension === "pdf") return pdf(bytes, signal);
    if (!["docx", "xlsx", "pptx"].includes(extension))
      throw new FileExtractionError("UNSUPPORTED");
    const files = archive(bytes);
    if (extension === "docx") {
      const tree = member(files, "word/document.xml");
      return [
        {
          kind: "TEXT",
          locator: "document:1",
          text: paragraphText(tree),
        },
      ];
    }
    if (extension === "pptx") {
      const mapping = relationships(
        files,
        "ppt/_rels/presentation.xml.rels",
        "ppt",
      );
      const slides = nodes(member(files, "ppt/presentation.xml"), "sldId");
      if (slides.length > fileExtractionLimits.sections)
        throw new FileExtractionError("RESOURCE_LIMIT");
      let characters = 0;
      return slides.map((node, index) => {
        const id = attrs(node)["@_r:id"],
          path = typeof id === "string" ? mapping.get(id) : undefined;
        if (!path) throw new FileExtractionError("MALFORMED");
        const tree = member(files, path);
        const text = paragraphText(
          tree,
          fileExtractionLimits.characters - characters,
        );
        characters += text.length;
        return {
          kind: "SLIDE",
          locator: `slide:${index + 1}`,
          text,
        };
      });
    }
    const mapping = relationships(files, "xl/_rels/workbook.xml.rels", "xl");
    const strings = files["xl/sharedStrings.xml"]
      ? nodes(xml(files["xl/sharedStrings.xml"]), "si").map((node) =>
          textNodes(array(node.si)),
        )
      : [];
    const sheets = nodes(member(files, "xl/workbook.xml"), "sheet");
    if (sheets.length > fileExtractionLimits.sections)
      throw new FileExtractionError("RESOURCE_LIMIT");
    let characters = 0;
    return sheets.map((node, index) => {
      const a = attrs(node),
        id = a["@_r:id"],
        path = typeof id === "string" ? mapping.get(id) : undefined;
      if (!path) throw new FileExtractionError("MALFORMED");
      const title = a["@_name"];
      const rows: string[] = [];
      for (const row of nodes(member(files, path), "row")) {
        let line = "",
          previousColumn = 0;
        for (const cell of nodes(array(row.row), "c")) {
          const reference = attrs(cell)["@_r"];
          const match =
            typeof reference === "string"
              ? /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference)
              : null;
          if (!match || Number(match[2]) > 1048576)
            throw new FileExtractionError("MALFORMED");
          let column = 0;
          for (const letter of match[1]!)
            column = column * 26 + letter.charCodeAt(0) - 64;
          if (column > 16384) throw new FileExtractionError("RESOURCE_LIMIT");
          if (column <= previousColumn)
            throw new FileExtractionError("MALFORMED");
          const type = attrs(cell)["@_t"];
          let value =
            type === "inlineStr"
              ? textNodes(array(cell.c))
              : textNodes(array(cell.c), "v");
          if (type === "s") {
            if (!/^\d+$/.test(value) || strings[Number(value)] === undefined)
              throw new FileExtractionError("MALFORMED");
            value = strings[Number(value)]!;
          }
          const tabs = column - previousColumn - (previousColumn === 0 ? 1 : 0);
          characters += tabs + value.length;
          if (characters > fileExtractionLimits.characters)
            throw new FileExtractionError("RESOURCE_LIMIT");
          line += "\t".repeat(tabs) + value;
          previousColumn = column;
        }
        if (rows.length) characters++;
        if (characters > fileExtractionLimits.characters)
          throw new FileExtractionError("RESOURCE_LIMIT");
        rows.push(line);
      }
      const text = rows.join("\n");
      return {
        kind: "SHEET",
        locator: `sheet:${index + 1}`,
        ...(typeof title === "string" ? { title } : {}),
        text,
      };
    });
  }
}
