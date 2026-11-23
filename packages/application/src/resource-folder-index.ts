import type { FolderLink } from "./folder-links";
import type { Organization } from "./organization";
import type { ProjectFolderLink, SpaceFolderLink } from "./scoped-folder-links";

export interface ResourceFolderSource {
  organization: readonly Organization[];
  folderLinks?: readonly FolderLink[] | undefined;
  spaceFolderLinks?: readonly SpaceFolderLink[] | undefined;
  projectFolderLinks?: readonly ProjectFolderLink[] | undefined;
}

interface CatalogFolder {
  id: string;
  path: string;
  name: string;
  parentId: string | null;
  projects: Map<string, string>;
  spaces: Map<string, string>;
}

/** References enrich existing rows only. No relationship grants visibility or changes the primary parent. */
export function indexResourceFolders(
  workspaceId: string,
  source: ResourceFolderSource | undefined,
  resources: ReadonlySet<string>,
  projectNames: ReadonlyMap<string, string>,
  spaceNames: ReadonlyMap<string, string>,
) {
  const folders = new Map<string, CatalogFolder>();
  const memberships = new Map<string, Set<string>>();
  if (!source) return { folders, memberships };
  const live = new Map(
    source.organization
      .filter(
        (f) =>
          f.workspaceId === workspaceId &&
          f.kind === "FOLDER" &&
          f.scope === "GENERAL" &&
          !f.archived,
      )
      .map((f) => [f.id, f]),
  );
  for (const folder of live.values()) {
    let current: Organization | undefined = folder;
    const path: string[] = [];
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.name) path.unshift(current.name);
      current = current.parentId ? live.get(current.parentId) : undefined;
    }
    folders.set(folder.id, {
      id: folder.id,
      path: path.join(" / "),
      name: folder.name ?? "",
      parentId:
        folder.parentId && live.has(folder.parentId) ? folder.parentId : null,
      projects: new Map(),
      spaces: new Map(),
    });
  }
  for (const link of source.folderLinks ?? []) {
    const key = link.targetKind + ":" + link.targetId;
    if (
      link.workspaceId !== workspaceId ||
      link.deletedAt ||
      !folders.has(link.folderId) ||
      !resources.has(key)
    )
      continue;
    const ids = memberships.get(key) ?? new Set<string>();
    ids.add(link.folderId);
    memberships.set(key, ids);
  }
  for (const link of source.projectFolderLinks ?? []) {
    const name = projectNames.get(link.projectId);
    if (
      link.workspaceId === workspaceId &&
      !link.deletedAt &&
      name !== undefined
    )
      folders.get(link.folderId)?.projects.set(link.projectId, name);
  }
  for (const link of source.spaceFolderLinks ?? []) {
    const name = spaceNames.get(link.spaceId);
    if (
      link.workspaceId === workspaceId &&
      !link.deletedAt &&
      name !== undefined
    )
      folders.get(link.folderId)?.spaces.set(link.spaceId, name);
  }
  return { folders, memberships };
}
