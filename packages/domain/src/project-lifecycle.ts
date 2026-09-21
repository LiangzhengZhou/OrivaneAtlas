import { DomainError, type WorkItem } from "./index";
import { projectAncestors, projectDescendants } from "./projects";

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
  if (project.status === "DONE") return "COMPLETED";
  if (project.status === "CANCELED") return "CANCELED";
  if (project.status === "IN_PROGRESS")
    return project.activationState === "INACTIVE" ? "PAUSED" : "ACTIVE";
  return "PLANNED";
}
export function projectLifecyclePatch(
  lifecycle: ProjectLifecycle,
): Pick<WorkItem, "status" | "activationState" | "activationPolicy"> {
  if (!projectLifecycles.includes(lifecycle))
    throw new DomainError("VALIDATION_ERROR", { field: "projectLifecycle" });
  return {
    status:
      lifecycle === "COMPLETED"
        ? "DONE"
        : lifecycle === "CANCELED"
          ? "CANCELED"
          : lifecycle === "PLANNED"
            ? "TODO"
            : "IN_PROGRESS",
    activationState: lifecycle === "PAUSED" ? "INACTIVE" : "ACTIVE",
    activationPolicy: "MANUAL",
  };
}
export function isTerminalWork(item: WorkItem): boolean {
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
export function requireProjectCompletable(
  project: WorkItem,
  items: readonly WorkItem[],
): void {
  const counts = projectCompletion(project, items);
  if (counts.unfinished || counts.unfinishedProjects)
    throw new DomainError("PROJECT_HAS_UNFINISHED_WORK", counts);
}
/** Reject introduced unfinished ownership, but allow repairs to legacy metadata. */
export function requireOpenProjectOwner(
  item: WorkItem,
  items: readonly WorkItem[],
  previous?: WorkItem,
): void {
  if (
    previous &&
    !previous.deletedAt &&
    previous.projectId === item.projectId &&
    !isTerminalWork(previous)
  )
    return;
  const unfinished =
    !isTerminalWork(item) ||
    (item.type === "PROJECT" &&
      projectDescendants(item, items).some((i) => !isTerminalWork(i)));
  if (!unfinished) return;
  const completed = projectAncestors(item, items).find(
    (p) => p.status === "DONE",
  );
  if (completed)
    throw new DomainError("PROJECT_REOPEN_REQUIRED", {
      projectId: completed.id,
    });
}
