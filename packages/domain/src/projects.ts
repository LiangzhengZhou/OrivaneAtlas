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
      !(item.projectId || item.projectIds?.length)
    )
      continue;
    for (const parent of item.type === "TASK"
      ? (item.projectIds ?? (item.projectId ? [item.projectId] : []))
      : item.projectId
        ? [item.projectId]
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
  if (item.type === "TASK" && item.projectIds !== undefined) {
    if (!item.projectIds.length) return undefined;
    let source: WorkItem | undefined;
    for (const projectId of item.projectIds) {
      const archived = projectAncestors({ ...item, projectId }, items).find(
        explicitlyArchived,
      );
      if (!archived) return undefined;
      source ??= archived;
    }
    return source;
  }
  return projectAncestors(item, items).find(explicitlyArchived);
}
