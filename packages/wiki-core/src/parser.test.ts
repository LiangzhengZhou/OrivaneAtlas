import { describe, expect, it } from "vitest";
import { indexDocument } from "./indexer";
import { parseHeadings, parseWikiLinks } from "./parser";

describe("wiki core", () => {
  it("indexes prose after closed inline and fenced code without indexing code or blank targets", () => {
    const markdown =
      "```md\n[[Code]]\n```\n[[After fence]]\n`[[Inline]]` [[After inline]]\n~~~\n[[Tilde code]]\n~~~\n[[After tilde]] [[   ]]";
    expect(parseWikiLinks(markdown).map((link) => link.targetText)).toEqual([
      "After fence",
      "After inline",
      "After tilde",
    ]);
    expect(
      parseWikiLinks("``code ` [[Hidden]]`` [[Visible]]").map(
        (link) => link.targetText,
      ),
    ).toEqual(["Visible"]);
    expect(parseWikiLinks("```\n[[Unclosed]]")).toEqual([]);
    expect(
      parseWikiLinks("\\[[Escaped]] \\\\[[Valid]]").map(
        (link) => link.targetText,
      ),
    ).toEqual(["Valid"]);
  });
  it("parses aliases, headings and embeds while excluding code", () => {
    const links = parseWikiLinks(
      "[[Page]] [[Page|Alias]] [[Page#Intro]] ![[Image]]\n`[[Code]]`\n```\n[[Fence]]\n```",
    );
    expect(
      links.map((link) => [
        link.targetText,
        link.alias,
        link.heading,
        link.embed,
      ]),
    ).toEqual([
      ["Page", null, null, false],
      ["Page", "Alias", null, false],
      ["Page", null, "Intro", false],
      ["Image", null, null, true],
    ]);
    expect(parseHeadings("# Home\n## Storage")).toEqual([
      { text: "Home", slug: "home", level: 1 },
      { text: "Storage", slug: "storage", level: 2 },
    ]);
  });
  it("keeps unresolved links and resolves aliases", () => {
    expect(
      indexDocument("source", "[[Storage|DB]] [[Future Architecture]]", [
        { id: "target", title: "Storage", aliases: ["DB"] },
      ]),
    ).toEqual([
      {
        sourceDocumentId: "source",
        targetDocumentId: "target",
        targetText: "Storage",
        alias: "DB",
        heading: null,
      },
      {
        sourceDocumentId: "source",
        targetDocumentId: null,
        targetText: "Future Architecture",
        alias: null,
        heading: null,
      },
    ]);
  });
});
