import type { WorkItem } from "@arclattice/domain";

/** Filtered or missing parents become roots; malformed legacy cycles stay bounded. */
export function projectTreeIndex(projects: readonly WorkItem[]) {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const childrenByParent = new Map<string | null, WorkItem[]>();
  for (const project of projects) {
    let parent = project.parentProjectId ?? null;
    if (!parent || !byId.has(parent)) parent = null;
    const visited = new Set([project.id]);
    let ancestor = parent;
    while (ancestor) {
      if (visited.has(ancestor)) {
        parent = null;
        break;
      }
      visited.add(ancestor);
      ancestor = byId.get(ancestor)?.parentProjectId ?? null;
    }
    const children = childrenByParent.get(parent) ?? [];
    children.push(project);
    childrenByParent.set(parent, children);
  }
  return childrenByParent;
}

export function projectProgressIndex(items: readonly WorkItem[]) {
  const projects = new Map(
    items
      .filter((item) => item.type === "PROJECT" && !item.deletedAt)
      .map((item) => [item.id, item]),
  );
  const result = new Map<
    string,
    { completed: number; unfinished: number; canceled: number }
  >();
  for (const id of projects.keys())
    result.set(id, { completed: 0, unfinished: 0, canceled: 0 });
  for (const task of items) {
    if (task.type !== "TASK" || task.deletedAt) continue;
    const ancestors = new Set<string>();
    for (const membership of task.projectIds ?? []) {
      let id: string | null = membership;
      const visited = new Set<string>();
      while (id && !visited.has(id)) {
        visited.add(id);
        const project = projects.get(id);
        if (!project || project.workspaceId !== task.workspaceId) break;
        ancestors.add(id);
        id = project.parentProjectId;
      }
    }
    for (const id of ancestors) {
      const counts = result.get(id);
      if (!counts) continue;
      if (task.status === "DONE") counts.completed++;
      else if (task.status === "CANCELED") counts.canceled++;
      else counts.unfinished++;
    }
  }
  return result;
}

export function visibleProjectBranches(
  children: ReadonlyMap<string | null, readonly WorkItem[]>,
  parentId: string | null,
  expandedIds: ReadonlySet<string>,
) {
  const result: WorkItem[] = [];
  const visited = new Set(parentId ? [parentId] : []);
  function visit(parent: string | null) {
    for (const project of children.get(parent) ?? []) {
      if (visited.has(project.id)) continue;
      visited.add(project.id);
      result.push(project);
      if (expandedIds.has(project.id)) visit(project.id);
    }
  }
  visit(parentId);
  return result;
}
