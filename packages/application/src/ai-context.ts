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
  name:
    | "search_documents"
    | "read_document"
    | "list_project_tasks"
    | "get_project"
    | "create_task"
    | "propose_document_edit"
    | "link_documents";
  risk: AiCapabilityRisk;
}
export const aiCapabilities: readonly AiCapability[] = [
  { name: "search_documents", risk: "READ" },
  { name: "read_document", risk: "READ" },
  { name: "list_project_tasks", risk: "READ" },
  { name: "get_project", risk: "READ" },
  { name: "create_task", risk: "WRITE" },
  { name: "propose_document_edit", risk: "PROPOSE" },
  { name: "link_documents", risk: "WRITE" },
];
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
