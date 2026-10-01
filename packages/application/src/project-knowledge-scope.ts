import type { WorkItem } from "@arclattice/domain";
import type { LibraryEntry } from "./library";
import type {
  ProjectKnowledgeBinding,
  ProjectMaterial,
} from "./project-materials";

export interface ProjectKnowledgeScope {
  spaceIds: string[];
  documentIds: string[];
}

/** Snapshot projection for consumers; ancestors are selected before the shared resolver. */
export function projectKnowledgeScope(input: {
  projectId?: string | undefined;
  workspaceId?: string | undefined;
  currentSpaceId?: string | undefined;
  items: readonly WorkItem[];
  projectMaterials: readonly ProjectMaterial[];
  library: readonly LibraryEntry[];
  workspaceFallback?: boolean;
}): ProjectKnowledgeScope {
  const projectId = input.projectId ?? "";
  const ancestors = new Set<string>();
  let cursor = input.items.find(
    (item) =>
      item.id === projectId && item.type === "PROJECT" && !item.deletedAt,
  );
  while (cursor?.parentProjectId && !ancestors.has(cursor.parentProjectId)) {
    ancestors.add(cursor.parentProjectId);
    cursor = input.items.find(
      (item) => item.id === cursor?.parentProjectId && !item.deletedAt,
    );
  }
  const bindings: ProjectKnowledgeBinding[] = input.projectMaterials
    .filter(
      (material) =>
        !material.deletedAt &&
        material.kind === "SPACE" &&
        material.targetId &&
        (material.projectId === projectId ||
          (ancestors.has(material.projectId) && material.inheritToChildren)),
    )
    .map((material) => ({
      id: material.id,
      workspaceId: material.workspaceId,
      projectId: material.projectId,
      spaceId: material.targetId!,
      ownership: material.ownership,
      role:
        material.role ??
        (material.ownership === "OWNED" ? "PRIMARY" : "REFERENCE"),
      inheritToChildren: material.inheritToChildren ?? false,
      version: material.version,
      createdBy: material.updatedBy,
      updatedAt: material.updatedAt,
    }));
  return resolveProjectKnowledgeScope({
    projectId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.currentSpaceId ? { currentSpaceId: input.currentSpaceId } : {}),
    bindings,
    library: input.library,
    workspaceFallback: input.workspaceFallback ?? !projectId,
  });
}

export function scopedKnowledgeDocuments(
  input: Parameters<typeof projectKnowledgeScope>[0],
): LibraryEntry[] {
  const scope = projectKnowledgeScope(input);
  const byId = new Map(input.library.map((entry) => [entry.id, entry]));
  return scope.documentIds.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
}

export function resolveProjectKnowledgeScope(input: {
  projectId: string;
  workspaceId?: string;
  currentSpaceId?: string;
  bindings: readonly ProjectKnowledgeBinding[];
  library: readonly LibraryEntry[];
  workspaceFallback?: boolean;
}): ProjectKnowledgeScope {
  const live = input.library.filter(
    (entry) =>
      !entry.deletedAt &&
      (!input.workspaceId || entry.workspaceId === input.workspaceId),
  );
  const rank = (binding: ProjectKnowledgeBinding) =>
    binding.projectId !== input.projectId
      ? 4
      : binding.ownership === "OWNED" && binding.role === "PRIMARY"
        ? 0
        : binding.ownership === "OWNED"
          ? 1
          : 2;
  const spaceIds = [
    ...new Set([
      ...(input.currentSpaceId ? [input.currentSpaceId] : []),
      ...input.bindings
        .filter(
          (binding) =>
            (!input.workspaceId || binding.workspaceId === input.workspaceId) &&
            (binding.projectId === input.projectId ||
              binding.inheritToChildren),
        )
        .sort((left, right) => rank(left) - rank(right))
        .map((binding) => binding.spaceId),
      ...(input.workspaceFallback
        ? live
            .filter((entry) => entry.kind === "SPACE")
            .map((entry) => entry.id)
        : []),
    ]),
  ].filter((id) =>
    live.some((entry) => entry.id === id && entry.kind === "SPACE"),
  );
  return {
    spaceIds,
    documentIds: spaceIds.flatMap((spaceId) =>
      live
        .filter(
          (entry) => entry.kind === "DOCUMENT" && entry.spaceId === spaceId,
        )
        .map((entry) => entry.id),
    ),
  };
}
