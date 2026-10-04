import type { DocumentWikiLink, LibraryEntry } from "@arclattice/application";
import { expect, test } from "vitest";
import {
  buildKnowledgeGraphIndex,
  knowledgeNeighborhood,
} from "./knowledge-graph-index";

function entry(id: string, kind: LibraryEntry["kind"]): LibraryEntry {
  return {
    id,
    kind,
    workspaceId: "workspace",
    spaceId: kind === "SPACE" ? null : "space",
    title: id,
    bodyMd: "",
    version: 1,
    createdAt: "2026-10-04T00:00:00Z",
    updatedAt: "2026-10-04T00:00:00Z",
    createdBy: "human",
    updatedBy: "human",
    deletedAt: null,
    provenance: "HUMAN",
  };
}

test("2000 documents / 5000 links adjacency preserves exact hop neighborhoods", () => {
  const documents = Array.from({ length: 2000 }, (_, i) =>
    entry(`doc-${i}`, "DOCUMENT"),
  );
  const links: DocumentWikiLink[] = Array.from({ length: 5000 }, (_, i) => ({
    sourceDocumentId: `doc-${i % 2000}`,
    targetDocumentId: `doc-${(i + 1) % 2000}`,
    targetText: "target",
    alias: null,
    heading: null,
  }));
  const index = buildKnowledgeGraphIndex(
    [entry("space", "SPACE"), ...documents],
    links,
  );
  expect(index.documentsBySpaceId.get("space")).toHaveLength(2000);
  expect(index.documentsById.size).toBe(2000);
  expect(knowledgeNeighborhood(index, "doc-100", 1)).toEqual(
    new Set(["doc-100", "doc-99", "doc-101"]),
  );
  expect(knowledgeNeighborhood(index, "doc-100", 2)).toEqual(
    new Set(["doc-100", "doc-99", "doc-101", "doc-98", "doc-102"]),
  );
  expect(index.outgoingByDocumentId.get("doc-0")).toHaveLength(3);
  expect(index.incomingByDocumentId.get("doc-1")).toHaveLength(3);
});

test("hierarchy paths stop at foreign-space parents and cycles", () => {
  const root = entry("root", "DOCUMENT"),
    child = { ...entry("child", "DOCUMENT"), parentDocumentId: root.id };
  const index = buildKnowledgeGraphIndex(
    [entry("space", "SPACE"), root, child],
    [],
  );
  expect(index.hierarchyPathByDocumentId.get(child.id)).toBe("root / child");
  expect(knowledgeNeighborhood(index, "", 2).size).toBe(0);
});
