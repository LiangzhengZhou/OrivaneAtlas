import type { LibraryEntry, Note } from "@arclattice/application";
import { expect, it } from "vitest";
import { work } from "../../../../../tests/fixtures";
import { noteWikiReferences } from "./note-wiki-references";

const space: LibraryEntry = {
  ...work("space"),
  kind: "SPACE",
  spaceId: null,
  bodyMd: "",
  provenance: "HUMAN",
};
const document: LibraryEntry = {
  ...work("document"),
  kind: "DOCUMENT",
  spaceId: "space",
  title: "Architecture",
  aliases: ["Design"],
  bodyMd: "",
  provenance: "HUMAN",
};
const capture: Note = {
  ...work("note"),
  kind: "NOTE",
  classification: "PRIVATE",
  boundary: "REMOTE",
  aiAccess: "DENY",
  day: null,
  bodyMd: "[[Design|Readable]]",
  provenance: "HUMAN",
};
it("derives Note and Journal backlinks with aliases while preserving the source Markdown", () => {
  const journal: Note = {
    ...capture,
    id: "journal",
    kind: "JOURNAL",
    day: "2026-10-02",
  };
  const links = noteWikiReferences([capture, journal], [space, document]);
  expect(
    links.map((link) => [link.sourceKind, link.targetDocumentId, link.alias]),
  ).toEqual([
    ["NOTE", "document", "Readable"],
    ["JOURNAL", "document", "Readable"],
  ]);
  expect(capture.bodyMd).toBe("[[Design|Readable]]");
  expect(
    noteWikiReferences([{ ...capture, deletedAt: "now" }], [space, document]),
  ).toEqual([]);
  expect(
    noteWikiReferences([capture], [{ ...space, deletedAt: "now" }, document])[0]
      ?.targetDocumentId,
  ).toBeNull();
});
it("cannot resolve foreign workspace pages and reconciles deletion and restoration", () => {
  expect(
    noteWikiReferences(
      [{ ...capture, workspaceId: "foreign" }],
      [space, document],
    )[0]?.targetDocumentId,
  ).toBeNull();
  expect(
    noteWikiReferences([capture], [space, { ...document, deletedAt: "now" }])[0]
      ?.targetDocumentId,
  ).toBeNull();
  expect(
    noteWikiReferences([capture], [space, document])[0]?.targetDocumentId,
  ).toBe("document");
});
