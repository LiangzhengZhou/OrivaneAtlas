import { expect, it } from "vitest";
import type { LibraryEntry } from "./library";
import { resolveProjectKnowledgeScope } from "./project-knowledge-scope";
import type { ProjectKnowledgeBinding } from "./project-materials";

it("orders current, primary, owned, linked, inherited and workspace fallback spaces", () => {
  const entry = (id: string): LibraryEntry => ({
    id,
    workspaceId: "workspace",
    kind: "SPACE",
    spaceId: null,
    title: id,
    bodyMd: "",
    version: 1,
    createdAt: "now",
    updatedAt: "now",
    createdBy: "human",
    updatedBy: "human",
    deletedAt: null,
    provenance: "HUMAN",
  });
  const binding = (
    spaceId: string,
    ownership: ProjectKnowledgeBinding["ownership"],
    role: ProjectKnowledgeBinding["role"],
    projectId = "project",
  ): ProjectKnowledgeBinding => ({
    id: spaceId,
    workspaceId: "workspace",
    projectId,
    spaceId,
    ownership,
    role,
    inheritToChildren: true,
    version: 1,
    createdBy: "human",
    updatedAt: "now",
  });
  const result = resolveProjectKnowledgeScope({
    projectId: "project",
    currentSpaceId: "current",
    workspaceFallback: true,
    library: [
      "fallback",
      "inherited",
      "linked",
      "owned",
      "primary",
      "current",
    ].map(entry),
    bindings: [
      binding("inherited", "OWNED", "PRIMARY", "parent"),
      binding("linked", "LINKED", "REFERENCE"),
      binding("owned", "OWNED", "SUPPORTING"),
      binding("primary", "OWNED", "PRIMARY"),
    ],
  });
  expect(result.spaceIds).toEqual([
    "current",
    "primary",
    "owned",
    "linked",
    "inherited",
    "fallback",
  ]);
});
