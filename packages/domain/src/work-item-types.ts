import type { WorkItem } from "./index";

/**
 * Discriminated views over the legacy single WorkItem shape. These are additive
 * type-narrowing helpers for the P2 migration; persistence keeps one table and
 * external DTO validation stays in the Application layer.
 */
export type ProjectWorkItem = WorkItem & {
  readonly type: "PROJECT";
  readonly lifecycle: NonNullable<WorkItem["lifecycle"]>;
};

export type TaskWorkItem = WorkItem & {
  readonly type: "TASK";
  readonly projectIds: readonly string[];
};

export type MilestoneWorkItem = WorkItem & { readonly type: "MILESTONE" };

export function isProjectWorkItem(item: WorkItem): item is ProjectWorkItem {
  return item.type === "PROJECT" && item.lifecycle !== null;
}

export function isTaskWorkItem(item: WorkItem): item is TaskWorkItem {
  return item.type === "TASK";
}

export function isMilestoneWorkItem(item: WorkItem): item is MilestoneWorkItem {
  return item.type === "MILESTONE";
}
