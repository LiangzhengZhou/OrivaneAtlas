import type { LibraryFile } from "@arclattice/domain";
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
  return {
    projects,
    notes: source.notes.filter((note) => visible(note) && note.kind === "NOTE"),
    documents: entries
      .filter((entry) => entry.kind === "DOCUMENT")
      .map((entry) => ({
        entry,
        location: titles.get(entry.spaceId ?? "") ?? "",
        projectIds: memberships.get("DOCUMENT:" + entry.id),
      })),
    files: source.files.filter(visible).map((entry) => ({
      entry,
      location: titles.get(entry.parentDocumentId ?? entry.spaceId ?? "") ?? "",
      projectIds: memberships.get("FILE:" + entry.id),
    })),
  };
}
