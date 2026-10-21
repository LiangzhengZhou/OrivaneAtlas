export type HierarchyEntry = {
  id: string;
  title: string;
  parentId: string | null;
};

export function buildHierarchyIndex(entries: readonly HierarchyEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const childrenByParentId = new Map<string | null, HierarchyEntry[]>();
  const searchTextById = new Map<string, string>();
  for (const entry of entries) {
    const children = childrenByParentId.get(entry.parentId) ?? [];
    children.push(entry);
    childrenByParentId.set(entry.parentId, children);
    searchTextById.set(entry.id, entry.title.toLocaleLowerCase());
  }
  const path = (id: string | null) => {
    const result: HierarchyEntry[] = [],
      visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const entry = byId.get(id);
      if (!entry) break;
      result.unshift(entry);
      id = entry.parentId;
    }
    return result;
  };
  return { byId, childrenByParentId, searchTextById, path };
}

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
