import {
  isExecutionActive,
  type WorkEdge,
  type WorkItem,
} from "@arclattice/domain";
import { taskDerivedIndex } from "./task-index";
import type { buildWorkspaceWorkIndex } from "./workspace-work-index";

export function selectTasks(
  items: readonly WorkItem[],
  edges: readonly WorkEdge[],
  today: string,
  isArchived: (item: WorkItem) => boolean,
  sharedDerived?: ReturnType<typeof taskDerivedIndex>,
  workIndex?: ReturnType<typeof buildWorkspaceWorkIndex>,
) {
  const derived = sharedDerived ?? taskDerivedIndex(items, edges, today);
  const live = items.filter((item) => item.type === "TASK" && !item.deletedAt);
  const active: WorkItem[] = [],
    archived: WorkItem[] = [];
  for (const item of live) (isArchived(item) ? archived : active).push(item);
  return {
    ...taskCollection(active, items, derived, today, workIndex),
    archived: taskCollection(archived, items, derived, today, workIndex),
  };
}
function taskCollection(
  tasks: WorkItem[],
  items: readonly WorkItem[],
  derived: ReturnType<typeof taskDerivedIndex>,
  today: string,
  workIndex?: ReturnType<typeof buildWorkspaceWorkIndex>,
) {
  const activeTasks = tasks.filter((item) => isExecutionActive(item, today));
  const openActiveTasks = activeTasks.filter(
    (item) => item.status !== "DONE" && item.status !== "CANCELED",
  );
  const readyTasks = openActiveTasks.filter(
    (item) =>
      item.status === "TODO" && !derived.blockersByTaskId.get(item.id)?.length,
  );
  const inProgressTasks = openActiveTasks.filter(
    (item) => item.status === "IN_PROGRESS",
  );
  const laterTasks = tasks.filter(
    (item) =>
      item.status !== "DONE" &&
      item.status !== "CANCELED" &&
      !isExecutionActive(item, today) &&
      item.activationPolicy !== "AT_SCHEDULED_TIME",
  );
  const scheduledTasks = tasks.filter(
    (item) =>
      item.status !== "DONE" &&
      item.status !== "CANCELED" &&
      !isExecutionActive(item, today) &&
      item.activationPolicy === "AT_SCHEDULED_TIME",
  );
  const completedTasks = tasks.filter((item) => item.status === "DONE");
  const tasksByStatus = new Map<string, string[]>();
  const tasksByProjectId = new Map<string, string[]>();
  for (const task of tasks) {
    const statusIds = tasksByStatus.get(task.status) ?? [];
    statusIds.push(task.id);
    tasksByStatus.set(task.status, statusIds);
    for (const projectId of task.projectIds ?? []) {
      const ids = tasksByProjectId.get(projectId) ?? [];
      ids.push(task.id);
      tasksByProjectId.set(projectId, ids);
    }
  }
  return {
    derived,
    blockersByTaskId: derived.blockersByTaskId,
    availabilityByTaskId: derived.availabilityByTaskId,
    projectTitlesByTaskId:
      workIndex?.projectTitleByTaskId ?? derived.projectTitlesByTaskId,
    archiveSourceByTaskId:
      workIndex?.archiveSourceByTaskId ?? new Map<string, WorkItem>(),
    itemsById:
      workIndex?.itemsById ?? new Map(items.map((item) => [item.id, item])),
    taskIds: tasks.map((item) => item.id),
    activeIds: activeTasks.map((item) => item.id),
    openActiveIds: openActiveTasks.map((item) => item.id),
    laterIds: laterTasks.map((item) => item.id),
    scheduledIds: scheduledTasks.map((item) => item.id),
    completedIds: completedTasks.map((item) => item.id),
    tasksByStatus,
    tasksByProjectId,
    tasks,
    activeTasks,
    openActiveTasks,
    readyTasks,
    inProgressTasks,
    completedTasks,
    laterTasks,
    scheduledTasks,
    focusTasks: [
      ...inProgressTasks,
      ...readyTasks.filter((item) => item.status !== "IN_PROGRESS"),
    ],
  };
}

export type TaskWorkspaceIndex = ReturnType<typeof taskCollection>;
