import {
  isExecutionActive,
  isReady,
  type WorkEdge,
  type WorkItem,
} from "@arclattice/domain";

export function selectTasks(
  items: readonly WorkItem[],
  edges: readonly WorkEdge[],
  today: string,
  isArchived: (item: WorkItem) => boolean,
) {
  const tasks = items.filter(
    (item) => item.type === "TASK" && !item.deletedAt && !isArchived(item),
  );
  const activeTasks = tasks.filter((item) => isExecutionActive(item, today));
  const openActiveTasks = activeTasks.filter(
    (item) => item.status !== "DONE" && item.status !== "CANCELED",
  );
  const readyTasks = openActiveTasks.filter((item) =>
    isReady(item, items, edges, today),
  );
  const inProgressTasks = openActiveTasks.filter(
    (item) => item.status === "IN_PROGRESS",
  );
  return {
    tasks,
    activeTasks,
    openActiveTasks,
    readyTasks,
    inProgressTasks,
    completedTasks: tasks.filter((item) => item.status === "DONE"),
    laterTasks: tasks.filter(
      (item) =>
        item.status !== "DONE" &&
        item.status !== "CANCELED" &&
        !isExecutionActive(item, today) &&
        item.activationPolicy !== "AT_SCHEDULED_TIME",
    ),
    scheduledTasks: tasks.filter(
      (item) =>
        item.status !== "DONE" &&
        item.status !== "CANCELED" &&
        !isExecutionActive(item, today) &&
        item.activationPolicy === "AT_SCHEDULED_TIME",
    ),
    focusTasks: [
      ...inProgressTasks,
      ...readyTasks.filter((item) => item.status !== "IN_PROGRESS"),
    ],
  };
}
