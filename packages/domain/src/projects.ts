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
  let id = item.type === "TASK" ? null : item.parentProjectId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = projects.get(id);
    if (!parent) break;
    result.push(parent);
    id = parent.parentProjectId;
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
      !(item.type === "TASK" ? item.projectIds?.length : item.parentProjectId)
    )
      continue;
    for (const parent of item.type === "TASK"
      ? (item.projectIds ?? [])
      : item.parentProjectId
        ? [item.parentProjectId]
        : []) {
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
  if (item.type === "TASK") {
    const memberships = items.filter(
      (project) =>
        project.workspaceId === item.workspaceId &&
        project.type === "PROJECT" &&
        !project.deletedAt &&
        item.projectIds?.includes(project.id),
    );
    if (!memberships.length) return undefined;
    const sources = memberships.map((project) =>
      explicitlyArchived(project)
        ? project
        : projectAncestors(project, items).find(explicitlyArchived),
    );
    return sources.every(Boolean) ? sources[0] : undefined;
  }
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
      !item.parentProjectId
    )
      continue;
    children.set(item.parentProjectId, [
      ...(children.get(item.parentProjectId) ?? []),
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
      top.parentProjectId === null &&
      ancestors.length + 1 + height <= MAX_PROJECT_DEPTH
    );
  });
}

export type ProjectScope = "DIRECT" | "SUBTREE";
export function effectiveCategoryId(
  project: WorkItem,
  items: readonly WorkItem[],
): string | null {
  return (
    [project, ...projectAncestors(project, items)].find(
      (entry) => entry.categoryId,
    )?.categoryId ?? null
  );
}
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
      item.type === "TASK" && item.projectIds?.some((id) => projectIds.has(id)),
  );
  const completed = tasks.filter((item) => item.status === "DONE").length;
  const canceled = tasks.filter((item) => item.status === "CANCELED").length;
  return {
    projects,
    projectIds,
    tasks,
    completed,
    canceled,
    unfinished: tasks.length - completed - canceled,
  };
}
export function projectPath(
  item: WorkItem,
  items: readonly WorkItem[],
): string {
  if (item.type === "TASK")
    return items
      .filter(
        (project) =>
          project.workspaceId === item.workspaceId &&
          project.type === "PROJECT" &&
          !project.deletedAt &&
          item.projectIds?.includes(project.id),
      )
      .map((project) =>
        [...projectAncestors(project, items).reverse(), project]
          .map((entry) => entry.title)
          .join(" / "),
      )
      .join(" · ");
  return projectAncestors(item, items)
    .reverse()
    .map((project) => project.title)
    .join(" / ");
}
