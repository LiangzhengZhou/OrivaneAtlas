import { capabilityRegistry } from "./capability-registry";
import type { EntityRef } from "./connected";
import type { ContentPolicy } from "./content-policy";

export interface AiContextItem {
  ref: EntityRef;
  title: string;
  version: number;
  source: "current" | "selected" | "retrieved" | "linked" | "mentioned";
  tokenEstimate: number;
  permission: ContentPolicy;
}
export type ExecutionApproval =
  | "REVIEW_EVERYTHING"
  | "REVIEW_WRITES"
  | "AUTO_SAFE";
export type AiCapabilityRisk = "READ" | "PROPOSE" | "WRITE" | "DESTRUCTIVE";
export interface AiCapability {
  previewOnly?: boolean;
  name:
    | "search_documents"
    | "read_document"
    | "list_project_tasks"
    | "get_project"
    | "create_task"
    | "update_task"
    | "complete_task"
    | "reschedule_task"
    | "set_task_priority"
    | "move_task_to_project"
    | "preview_plan"
    | "publish_plan"
    | "create_document"
    | "move_document"
    | "propose_document_edit"
    | "link_documents";
  risk: AiCapabilityRisk;
}
export const aiCapabilities: readonly AiCapability[] = capabilityRegistry.map(
  (entry) => ({
    name: entry.name as AiCapability["name"],
    risk: entry.risk,
    ...(entry.previewOnly ? { previewOnly: true } : {}),
  }),
);
export function requiresExecutionApproval(
  risk: AiCapabilityRisk,
  approval: ExecutionApproval,
): boolean {
  return (
    approval === "REVIEW_EVERYTHING" ||
    risk === "DESTRUCTIVE" ||
    (approval === "REVIEW_WRITES" && risk !== "READ")
  );
}
