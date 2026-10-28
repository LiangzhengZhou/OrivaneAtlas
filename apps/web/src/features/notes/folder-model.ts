import type { Organization, WorkspaceNote } from "@arclattice/application";

export interface FolderNode {
  folder: Organization;
  depth: number;
  children: FolderNode[];
}
export type FolderSelection = string | null;
export interface LegacyFolderGroup {
  name: string;
  noteIds: string[];
}
export function folderKey(id: string): string {
  return "folder:" + id;
}
export const unfiledKey = "folder:";

/** Active folders grouped by parent, sorted by display name then identity. */
export function buildFolderTree(
  folders: readonly Organization[],
): FolderNode[] {
  const active = folders.filter(
    (folder) => folder.kind === "FOLDER" && !folder.archived,
  );
  const byParent = new Map<string, Organization[]>();
  const ids = new Set(active.map((folder) => folder.id));
  for (const folder of active) {
    const parent = ids.has(folder.parentId ?? "")
      ? (folder.parentId ?? "")
      : "";
    byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
  }
  const build = (parent: string, depth: number): FolderNode[] =>
    (byParent.get(parent) ?? [])
      .slice()
      .sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "", undefined, {
          sensitivity: "base",
        }),
      )
      .map((folder) => ({
        folder,
        depth,
        children: build(folder.id, depth + 1),
      }));
  return build("", 0);
}

/** Full "A / B" display path for one stable folder identity. */
export function folderPath(
  id: string,
  folders: readonly Organization[],
): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const folder = byId.get(cursor);
    if (!folder) break;
    names.unshift(folder.name ?? "");
    cursor = folder.parentId ?? "";
  }
  return names.filter(Boolean).join(" / ");
}

/** Valid destinations for moving one folder; root is the empty identity. */
export function folderMoveTargets(
  moving: Organization,
  folders: readonly Organization[],
): Organization[] {
  const forbidden = folderSubtreeIds(moving.id, folders);
  return folders
    .filter(
      (folder) =>
        folder.kind === "FOLDER" &&
        !folder.archived &&
        !forbidden.has(folder.id),
    )
    .slice()
    .sort((a, b) =>
      folderPath(a.id, folders).localeCompare(folderPath(b.id, folders)),
    );
}

function folderSubtreeIds(
  id: string,
  folders: readonly Organization[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.kind !== "FOLDER") continue;
    const parent = folder.parentId ?? "";
    children.set(parent, [...(children.get(parent) ?? []), folder.id]);
  }
  const result = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const next = pending.pop()!;
    if (result.has(next)) continue;
    result.add(next);
    pending.push(...(children.get(next) ?? []));
  }
  return result;
}

/** Legacy free-text groups shown as read-only folder-like nodes. */
export function legacyFolderGroups(
  notes: readonly WorkspaceNote[],
  organizationByKey: ReadonlyMap<string, Organization>,
): LegacyFolderGroup[] {
  const groups = new Map<string, string[]>();
  for (const note of notes) {
    const entry = organizationByKey.get("NOTE:" + note.id);
    if (!entry || (entry.folderId ?? "")) continue;
    const name = (entry.folder ?? "").trim();
    if (!name) continue;
    groups.set(name, [...(groups.get(name) ?? []), note.id]);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, noteIds]) => ({ name, noteIds }));
}

/** The tree/filter identity a note belongs to, or unfiledKey. */
export function noteFolderKey(
  note: WorkspaceNote,
  organizationByKey: ReadonlyMap<string, Organization>,
): string {
  const entry = organizationByKey.get("NOTE:" + note.id);
  if (!entry) return unfiledKey;
  if (entry.folderId) return folderKey(entry.folderId);
  return entry.folder ? "legacy:" + entry.folder : unfiledKey;
}

export function noteFolderLabel(
  note: WorkspaceNote,
  organizationByKey: ReadonlyMap<string, Organization>,
  folders: readonly Organization[],
  unfiledLabel: string,
  legacyLabel: string,
): string {
  const entry = organizationByKey.get("NOTE:" + note.id);
  if (entry?.folderId) {
    const path = folderPath(entry.folderId, folders);
    if (path) return path;
  }
  if (entry?.folder) return `${legacyLabel}: ${entry.folder}`;
  return unfiledLabel;
}

/** Grouped counts used by the tree summary. */
export function folderCounts(
  notes: readonly WorkspaceNote[],
  organizationByKey: ReadonlyMap<string, Organization>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const key = noteFolderKey(note, organizationByKey);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
