import type { LibraryFile } from "@arclattice/domain";
import { expect, test } from "vitest";
import { privateContentPolicy } from "./content-policy";
import type { LibraryEntry } from "./library";
import type { ProjectMaterial } from "./project-materials";
import { selectResourceCatalog } from "./resource-catalog";

test("catalog preserves typed memberships and uses only live rows in the authorized workspace", () => {
  const shared = {
    workspaceId: "atlas",
    createdAt: "2026-11-23",
    updatedAt: "2026-11-23",
    createdBy: "owner",
    updatedBy: "owner",
    version: 1,
    deletedAt: null,
  };
  const space: LibraryEntry = {
    ...shared,
    id: "space",
    kind: "SPACE",
    spaceId: null,
    title: "Fieldwork",
    bodyMd: "",
    provenance: "HUMAN",
  };
  const document: LibraryEntry = {
    ...space,
    id: "same-id",
    kind: "DOCUMENT",
    title: "Reading list",
    spaceId: space.id,
  };
  const file: LibraryFile = {
    ...shared,
    id: "same-id",
    name: "map.pdf",
    originalName: "map.pdf",
    extension: "pdf",
    mime: "application/pdf",
    size: 42,
    contentHash: "abcd",
    blobId: "bytes",
    spaceId: space.id,
    parentDocumentId: document.id,
    provenance: "HUMAN",
    aiPolicy: privateContentPolicy,
    indexStatus: "PENDING",
    extractionStatus: "PENDING",
  };
  const projects = ["a", "b"].map((id) => ({ ...shared, id, title: id }));
  const material: ProjectMaterial = {
    ...shared,
    id: "m1",
    projectId: "a",
    kind: "DOCUMENT",
    ownership: "LINKED",
    targetId: document.id,
    title: "List",
    mime: null,
    size: 0,
  };
  const result = selectResourceCatalog("atlas", {
    projects,
    notes: [],
    library: [
      space,
      document,
      { ...space, workspaceId: "other", title: "Private foreign title" },
    ],
    files: [
      file,
      { ...file, id: "deleted", deletedAt: shared.updatedAt },
      { ...file, id: "foreign", workspaceId: "other" },
    ],
    materials: [
      material,
      { ...material, id: "m2", projectId: "b" },
      { ...material, id: "m3", kind: "FILE", projectId: "b" },
      {
        ...material,
        id: "m4",
        kind: "FILE",
        projectId: "a",
        deletedAt: shared.updatedAt,
      },
      { ...material, id: "m5", kind: "FILE", workspaceId: "other" },
    ],
  });
  expect(result.documents).toEqual([
    { entry: document, location: "Fieldwork", projectIds: new Set(["a", "b"]) },
  ]);
  expect(result.files).toEqual([
    { entry: file, location: "Reading list", projectIds: new Set(["b"]) },
  ]);
});
