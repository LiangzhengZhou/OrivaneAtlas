import { describe, expect, it } from "vitest";
import type { WorkItem } from "./index";
import {
  isMilestoneWorkItem,
  isProjectWorkItem,
  isTaskWorkItem,
  type ProjectWorkItem,
  type TaskWorkItem,
} from "./work-item-types";

const base = {
  workspaceId: "w",
  title: "item",
  descriptionMd: "",
  status: "TODO",
  priority: "MEDIUM",
  executionMode: "MANUAL",
  assigneePrincipalId: null,
  parentProjectId: null,
  lifecycle: null,
  categoryId: null,
  activationState: "ACTIVE",
  activationPolicy: "MANUAL",
  startDate: null,
  dueDate: null,
  version: 1,
  createdBy: "p",
  updatedBy: "p",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  completedAt: null,
  deletedAt: null,
} satisfies Omit<WorkItem, "id" | "type">;

describe("work item discriminated views", () => {
  it("narrows a project with a lifecycle", () => {
    const item = {
      ...base,
      id: "p",
      type: "PROJECT",
      lifecycle: "ACTIVE",
    } as unknown as WorkItem;
    expect(isProjectWorkItem(item)).toBe(true);
    if (!isProjectWorkItem(item)) throw new Error("expected project");
    const project: ProjectWorkItem = item;
    expect(project.lifecycle).toBe("ACTIVE");
  });

  it("rejects a project without lifecycle as a project view", () => {
    const item = { ...base, id: "p", type: "PROJECT" } as unknown as WorkItem;
    expect(isProjectWorkItem(item)).toBe(false);
  });

  it("narrows tasks and milestones", () => {
    const task = { ...base, id: "t", type: "TASK" } as WorkItem;
    const milestone = { ...base, id: "m", type: "MILESTONE" } as WorkItem;
    expect(isTaskWorkItem(task)).toBe(true);
    expect(isMilestoneWorkItem(milestone)).toBe(true);
    const typed: TaskWorkItem = task as TaskWorkItem;
    expect(typed.type).toBe("TASK");
  });
});
