import type { ActivityEvent, OutboxEvent } from "@arclattice/application";
import type { WorkEdge, WorkItem } from "@arclattice/domain";
export const workFields = {
  workspaceId: "workspace_id",
  id: "id",
  type: "type",
  title: "title",
  descriptionMd: "description_md",
  status: "status",
  priority: "priority",
  executionMode: "execution_mode",
  assigneePrincipalId: "assignee_principal_id",
  projectId: "project_id",
  activationState: "activation_state",
  activationPolicy: "activation_policy",
  startDate: "start_date",
  dueDate: "due_date",
  version: "version",
  createdBy: "created_by",
  updatedBy: "updated_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
  completedAt: "completed_at",
  deletedAt: "deleted_at",
} satisfies Record<Exclude<keyof WorkItem, "projectIds">, string>;
export const edgeFields = {
  workspaceId: "workspace_id",
  id: "id",
  fromId: "from_id",
  toId: "to_id",
  type: "type",
  createdBy: "created_by",
  createdAt: "created_at",
} satisfies Record<keyof WorkEdge, string>;
export const activityFields = {
  fromId: "from_id",
  toId: "to_id",
  edgeType: "edge_type",
  workspaceId: "workspace_id",
  id: "id",
  principalId: "principal_id",
  entityId: "entity_id",
  type: "type",
  occurredAt: "occurred_at",
} satisfies Record<keyof ActivityEvent, string>;
export const outboxFields = {
  workspaceId: "workspace_id",
  id: "id",
  activityId: "activity_id",
  type: "type",
  occurredAt: "occurred_at",
} satisfies Record<keyof OutboxEvent, string>;
export function projection(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(
      ([key, column]) =>
        (column === "version" ? "version::float8" : column) +
        ' AS "' +
        key +
        '"',
    )
    .join(", ");
}
