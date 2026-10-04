import type { WorkItem } from "@arclattice/domain";
import { createContext } from "react";

export function buildWorkspaceWorkIndex<
  T extends { kind: string; id: string; archived: boolean },
>(items: readonly WorkItem[], organization: readonly T[]) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const projectsById = new Map(
    items
      .filter((item) => item.type === "PROJECT" && !item.deletedAt)
      .map((item) => [item.id, item]),
  );
  const organizationByKey = new Map(
    organization.map((entry) => [`${entry.kind}:${entry.id}`, entry]),
  );
  const explicitArchivedByWorkId = new Map(
    items.map((item) => [
      item.id,
      organizationByKey.get(`WORK:${item.id}`)?.archived ?? false,
    ]),
  );
  const parentProjectById = new Map<string, string>();
  const childrenByProjectId = new Map<string, string[]>();
  const ancestorIdsByProjectId = new Map<string, string[]>();
  const projectPathById = new Map<string, string>();
  const archiveSourceByProjectId = new Map<string, WorkItem>();
  const archiveSourceByTaskId = new Map<string, WorkItem>();
  const tasksByProjectId = new Map<string, string[]>();
  const taskProjectIds = new Map<string, string[]>();
  const projectTitleByTaskId = new Map<string, string>();
  const unassignedTaskIds: string[] = [];
  const searchTextByWorkId = new Map(
    items.map((item) => [item.id, item.title.toLocaleLowerCase()]),
  );
  for (const project of projectsById.values()) {
    const parent = project.parentProjectId
      ? projectsById.get(project.parentProjectId)
      : undefined;
    if (parent && parent.workspaceId === project.workspaceId) {
      parentProjectById.set(project.id, parent.id);
      const children = childrenByProjectId.get(parent.id) ?? [];
      children.push(project.id);
      childrenByProjectId.set(parent.id, children);
    }
  }
  for (const project of projectsById.values()) {
    const ancestors: string[] = [];
    const seen = new Set([project.id]);
    let parent = parentProjectById.get(project.id);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      ancestors.push(parent);
      parent = parentProjectById.get(parent);
    }
    ancestorIdsByProjectId.set(project.id, ancestors);
    projectPathById.set(
      project.id,
      [...ancestors]
        .reverse()
        .concat(project.id)
        .map((id) => projectsById.get(id)?.title ?? "")
        .join(" / "),
    );
    const source = ancestors.find((id) => explicitArchivedByWorkId.get(id));
    if (source)
      archiveSourceByProjectId.set(project.id, projectsById.get(source)!);
  }
  for (const task of items) {
    if (task.type !== "TASK" || task.deletedAt) continue;
    const memberships = (task.projectIds ?? []).filter(
      (id) => projectsById.get(id)?.workspaceId === task.workspaceId,
    );
    taskProjectIds.set(task.id, memberships);
    if (!memberships.length) unassignedTaskIds.push(task.id);
    projectTitleByTaskId.set(
      task.id,
      memberships.map((id) => projectsById.get(id)!.title).join(" · "),
    );
    for (const id of memberships) {
      const tasks = tasksByProjectId.get(id) ?? [];
      tasks.push(task.id);
      tasksByProjectId.set(id, tasks);
    }
    const sources = memberships.map((id) =>
      explicitArchivedByWorkId.get(id)
        ? projectsById.get(id)
        : archiveSourceByProjectId.get(id),
    );
    if (sources.length && sources.every(Boolean))
      archiveSourceByTaskId.set(task.id, sources[0]!);
  }
  const archiveSource = (item: WorkItem) =>
    item.type === "TASK"
      ? archiveSourceByTaskId.get(item.id)
      : archiveSourceByProjectId.get(item.id);
  const isArchived = (item: WorkItem) =>
    !!explicitArchivedByWorkId.get(item.id) || !!archiveSource(item);
  return {
    unassignedTaskIds,
    searchTextByWorkId,
    itemsById,
    projectsById,
    organizationByKey,
    parentProjectById,
    childrenByProjectId,
    ancestorIdsByProjectId,
    tasksByProjectId,
    taskProjectIds,
    explicitArchivedByWorkId,
    archiveSourceByProjectId,
    archiveSourceByTaskId,
    projectPathById,
    projectTitleByTaskId,
    archiveSource,
    isArchived,
  };
}

export type WorkspaceWorkIndex = ReturnType<typeof buildWorkspaceWorkIndex>;
export const WorkspaceWorkIndexContext =
  createContext<WorkspaceWorkIndex | null>(null);
