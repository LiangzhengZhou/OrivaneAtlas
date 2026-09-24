import { DomainError, type WorkItem } from "./index";
import { projectDescendants } from "./projects";

export const projectLifecycles = [
  "PLANNED",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "CANCELED",
] as const;
export type ProjectLifecycle = (typeof projectLifecycles)[number];
export function projectLifecycle(project: WorkItem): ProjectLifecycle {
  if (project.type !== "PROJECT")
    throw new DomainError("VALIDATION_ERROR", { field: "projectLifecycle" });
  return project.lifecycle ?? "PLANNED";
}
export function projectLifecyclePatch(
  lifecycle: ProjectLifecycle,
): Pick<WorkItem, "lifecycle"> {
  if (!projectLifecycles.includes(lifecycle))
    throw new DomainError("VALIDATION_ERROR", { field: "projectLifecycle" });
  return { lifecycle };
}
export function isTerminalWork(item: WorkItem): boolean {
  if (item.type === "PROJECT")
    return item.lifecycle === "COMPLETED" || item.lifecycle === "CANCELED";
  return item.status === "DONE" || item.status === "CANCELED";
}
export function projectCompletion(
  project: WorkItem,
  items: readonly WorkItem[],
) {
  const descendants = projectDescendants(project, items);
  const tasks = descendants.filter((i) => i.type === "TASK");
  return {
    completed: tasks.filter((i) => i.status === "DONE").length,
    canceled: tasks.filter((i) => i.status === "CANCELED").length,
    unfinished: tasks.filter((i) => !isTerminalWork(i)).length,
    unfinishedProjects: descendants.filter(
      (i) => i.type === "PROJECT" && !isTerminalWork(i),
    ).length,
  };
}
