export type HierarchyEntry = {
  id: string;
  title: string;
  parentId: string | null;
};

export function currentLevel(
  entries: readonly HierarchyEntry[],
  parentId: string | null,
  query = "",
) {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      entry.parentId === parentId &&
      entry.title.toLocaleLowerCase().includes(search),
  );
}

export function hierarchyPath(
  entries: readonly HierarchyEntry[],
  id: string | null,
): HierarchyEntry[] {
  const path: HierarchyEntry[] = [];
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) break;
    path.unshift(entry);
    id = entry.parentId;
  }
  return path;
}

export function excludedBranch(
  entries: readonly HierarchyEntry[],
  id: string,
): Set<string> {
  const excluded = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (
        entry.parentId &&
        excluded.has(entry.parentId) &&
        !excluded.has(entry.id)
      ) {
        excluded.add(entry.id);
        changed = true;
      }
    }
  }
  return excluded;
}
