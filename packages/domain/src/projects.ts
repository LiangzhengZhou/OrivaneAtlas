import type { WorkItem } from "./index";

/** Maximum supported nested project depth, including the project itself. */
export const MAX_PROJECT_DEPTH = 16;

/** Workspace-scoped, read-only projection with bounded traversal. */
export function projectAncestors(
  item: WorkItem,
  items: readonly WorkItem[],
): WorkItem[] {
  const projects = new Map(
    items
      .filter(
        (p) =>
          p.workspaceId === item.workspaceId &&
          p.type === "PROJECT" &&
          !p.deletedAt,
      )
      .map((p) => [p.id, p]),
  );
  const seen = new Set([item.id]);
  const result: WorkItem[] = [];
  let id = item.projectId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = projects.get(id);
    if (!parent) break;
    result.push(parent);
    id = parent.projectId;
  }
  return result;
}

export function projectDescendants(
  project: WorkItem,
  items: readonly WorkItem[],
): WorkItem[] {
  if (project.type !== "PROJECT" || project.deletedAt) return [];
  const children = new Map<string, WorkItem[]>();
  for (const item of items) {
    if (
      item.workspaceId !== project.workspaceId ||
      item.deletedAt ||
      !item.projectId
    )
      continue;
    for (const parent of item.projectId ? [item.projectId] : []) {
      const siblings = children.get(parent) ?? [];
      siblings.push(item);
      children.set(parent, siblings);
    }
  }
  const result: WorkItem[] = [];
  const pending = [project.id];
  const seen = new Set(pending);
  while (pending.length) {
    const id = pending.pop();
    if (!id) continue;
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      if (child.type === "PROJECT") pending.push(child.id);
    }
  }
  return result;
}

/** Responsible ancestor for an actionable UI explanation. */
export function inheritedArchiveSource(
  item: WorkItem,
  items: readonly WorkItem[],
  explicitlyArchived: (item: WorkItem) => boolean,
): WorkItem | undefined {
  return projectAncestors(item, items).find(explicitlyArchived);
}

/** Structural project height, including the root; task references never count. */
export function projectSubtreeHeight(
  project: WorkItem,
  items: readonly WorkItem[],
): number {
  const children = new Map<string, WorkItem[]>();
  for (const item of items) {
    if (
      item.type !== "PROJECT" ||
      item.deletedAt ||
      item.workspaceId !== project.workspaceId ||
      !item.projectId
    )
      continue;
    children.set(item.projectId, [
      ...(children.get(item.projectId) ?? []),
      item,
    ]);
  }
  const pending: [string, number][] = [[project.id, 1]];
  const seen = new Set<string>();
  let height = 1;
  while (pending.length) {
    const [id, depth] = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    height = Math.max(height, depth);
    for (const child of children.get(id) ?? [])
      pending.push([child.id, depth + 1]);
  }
  return height;
}

/** Selectable parents for a whole-subtree move within the supplied workspace. */
export function eligibleProjectParents(
  project: WorkItem | null,
  items: readonly WorkItem[],
): WorkItem[] {
  const height = project ? projectSubtreeHeight(project, items) : 1;
  const descendants = new Set(
    project ? projectDescendants(project, items).map((p) => p.id) : [],
  );
  return items.filter((candidate) => {
    if (
      candidate.type !== "PROJECT" ||
      candidate.deletedAt ||
      candidate.id === project?.id ||
      descendants.has(candidate.id)
    )
      return false;
    if (project && candidate.workspaceId !== project.workspaceId) return false;
    const ancestors = projectAncestors(candidate, items);
    const top = ancestors.at(-1) ?? candidate;
    return (
      top.projectId === null &&
      ancestors.length + 1 + height <= MAX_PROJECT_DEPTH
    );
  });
}

/** Compatibility read model: ownership is structural, links provide context only. */
export function taskOwnership(item: WorkItem): {
  ownerProjectId: string | null;
  linkedProjectIds: readonly string[];
} {
  return {
    ownerProjectId: item.projectId,
    linkedProjectIds: [...new Set(item.projectIds ?? [])].filter(
      (id) => id !== item.projectId,
    ),
  };
}
export type ProjectScope = "DIRECT" | "SUBTREE";
export function projectScope(
  project: WorkItem,
  items: readonly WorkItem[],
  scope: ProjectScope,
) {
  const live = items.filter(
    (item) => item.workspaceId === project.workspaceId && !item.deletedAt,
  );
  const descendants = projectDescendants(project, live).filter(
    (item) => item.type === "PROJECT",
  );
  const projects = scope === "SUBTREE" ? [project, ...descendants] : [project];
  const projectIds = new Set(projects.map((item) => item.id));
  const tasks = live.filter(
    (item) =>
      item.type === "TASK" &&
      !!item.projectId &&
      projectIds.has(item.projectId),
  );
  const taskIds = new Set(tasks.map((item) => item.id));
  const linkedTasks = live.filter(
    (item) =>
      item.type === "TASK" &&
      !taskIds.has(item.id) &&
      taskOwnership(item).linkedProjectIds.some((id) => projectIds.has(id)),
  );
  const completed = tasks.filter((item) => item.status === "DONE").length;
  const canceled = tasks.filter((item) => item.status === "CANCELED").length;
  return {
    projects,
    projectIds,
    tasks,
    linkedTasks,
    completed,
    canceled,
    unfinished: tasks.length - completed - canceled,
  };
}
export function projectPath(
  item: WorkItem,
  items: readonly WorkItem[],
): string {
  return projectAncestors(item, items)
    .reverse()
    .map((project) => project.title)
    .join(" / ");
}
