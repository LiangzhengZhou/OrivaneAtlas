import type { LibraryFile } from "@arclattice/domain";
import {
  indexResourceFolders,
  type ResourceFolderSource,
} from "./resource-folder-index";

export type { ResourceFolderSource } from "./resource-folder-index";

import type { ProjectMaterial } from "./project-materials";
import type {
  WorkspaceLibraryEntry,
  WorkspaceNote,
} from "./workspace-bootstrap";

/** Read projection over a principal's authorized snapshot. Sources own visibility and writes. */
export function selectResourceCatalog(
  workspaceId: string,
  source: {
    notes: readonly WorkspaceNote[];
    library: readonly WorkspaceLibraryEntry[];
    files: readonly LibraryFile[];
    projects: readonly {
      id: string;
      title: string;
      workspaceId: string;
      deletedAt: string | null;
    }[];
    materials: readonly ProjectMaterial[];
    relations?: ResourceFolderSource | undefined;
  },
) {
  const visible = (entity: { workspaceId: string; deletedAt: string | null }) =>
    entity.workspaceId === workspaceId && !entity.deletedAt;
  const entries = source.library.filter(visible);
  const titles = new Map(entries.map((entry) => [entry.id, entry.title]));
  const projects = source.projects.filter(visible);
  const projectIds = new Set(projects.map((project) => project.id));
  const memberships = new Map<string, Set<string>>();
  for (const material of source.materials) {
    if (
      !visible(material) ||
      !material.targetId ||
      !projectIds.has(material.projectId)
    )
      continue;
    const key = material.kind + ":" + material.targetId;
    const set = memberships.get(key) ?? new Set<string>();
    set.add(material.projectId);
    memberships.set(key, set);
  }
  const notes = source.notes.filter(
    (note) => visible(note) && note.kind === "NOTE",
  );
  const files = source.files.filter(visible);
  const byContent = new Map<string, LibraryFile[]>();
  for (const file of files) {
    if (!/^[0-9a-f]{64}$/.test(file.contentHash)) continue;
    const key = file.contentHash + ":" + file.size;
    const group = byContent.get(key);
    if (group) group.push(file);
    else byContent.set(key, [file]);
  }
  const duplicateFiles = new Map<string, readonly LibraryFile[]>();
  for (const group of byContent.values()) {
    if (group.length > 1)
      for (const file of group) duplicateFiles.set(file.id, group);
  }
  const documents = entries.filter((entry) => entry.kind === "DOCUMENT");
  const resourceKeys = new Set([
    ...notes.map((n) => "NOTE:" + n.id),
    ...documents.map((d) => "DOCUMENT:" + d.id),
    ...files.map((f) => "FILE:" + f.id),
  ]);
  const projectNames = new Map(projects.map((p) => [p.id, p.title]));
  const spaceNames = new Map(
    entries.filter((e) => e.kind === "SPACE").map((s) => [s.id, s.title]),
  );
  return {
    folderIndex: indexResourceFolders(
      workspaceId,
      source.relations,
      resourceKeys,
      projectNames,
      spaceNames,
    ),
    projectNames,
    duplicateFiles,
    projects,
    notes,
    documents: documents.map((entry) => ({
      entry,
      location: titles.get(entry.spaceId ?? "") ?? "",
      projectIds: memberships.get("DOCUMENT:" + entry.id),
    })),
    files: files.map((entry) => ({
      entry,
      location: titles.get(entry.parentDocumentId ?? entry.spaceId ?? "") ?? "",
      projectIds: memberships.get("FILE:" + entry.id),
    })),
  };
}
