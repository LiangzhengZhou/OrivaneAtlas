import { capabilityRegistry } from "./capability-registry";
import type { EntityRef } from "./connected";
import type { ContentPolicy } from "./content-policy";
import type { EntityMemoTarget } from "./entity-memos";

export interface AiContextItem {
  ref: EntityRef | { kind: "MEMO"; id: string; target: EntityMemoTarget };
  title: string;
  version: number;
  source: "current" | "selected" | "retrieved" | "linked" | "mentioned";
  tokenEstimate: number;
  permission: ContentPolicy;
}

/** Memo citations open their attached entity, never impersonate a Document. */
export function aiContextNavigationRef(ref: AiContextItem["ref"]): EntityRef {
  return ref.kind === "MEMO"
    ? {
        kind: ref.target.targetKind === "FILE" ? "FILE" : "WORK",
        id: ref.target.targetId,
      }
    : ref;
}
export type ExecutionApproval =
  | "REVIEW_EVERYTHING"
  | "REVIEW_WRITES"
  | "AUTO_SAFE";
export type AiCapabilityRisk = "READ" | "PROPOSE" | "WRITE" | "DESTRUCTIVE";
export interface AiCapability {
  previewOnly?: boolean;
  name:
    | "read_file_chunks"
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
