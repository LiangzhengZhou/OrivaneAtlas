import type { WorkEdge, WorkItem } from "../packages/domain/src/index";

export function work(id: string, workspaceId = "workspace-a"): WorkItem {
  return {
    id,
    workspaceId,
    type: "TASK",
    title: id,
    descriptionMd: "# Markdown\n\n- [ ] content only",
    status: "TODO",
    priority: "MEDIUM",
    executionMode: "MANUAL",
    assigneePrincipalId: null,
    projectId: null,
    activationState: "ACTIVE",
    activationPolicy: "MANUAL",
    startDate: null,
    dueDate: null,
    version: 1,
    createdBy: "human",
    updatedBy: "human",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
  };
}
export function edge(
  fromId: string,
  toId: string,
  type: WorkEdge["type"] = "BLOCKS",
  workspaceId = "workspace-a",
): WorkEdge {
  return {
    id: `${fromId}-${toId}-${type}`,
    workspaceId,
    fromId,
    toId,
    type,
    createdBy: "human",
    createdAt: "2026-09-13T00:00:00.000Z",
  };
}
