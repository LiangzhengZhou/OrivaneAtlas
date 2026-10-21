import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceChange, WorkTransaction } from "@arclattice/application";
import { DomainError } from "@arclattice/domain";

const tables: Record<string, string> = {
  files: "library_file",
  manualOrders: "manual_order_scope",
  items: "work_item",
  edges: "work_edge",
  notes: "notebook",
  links: "knowledge_link",
  library: "library_entry",
  organization: "organization",
  categories: "project_category",
  workflows: "workflow_record",
  wikiLinks: "document_wiki_link",
  projectMaterials: "project_material",
  reminders: "reminder",
  navigationPreference: "user_navigation",
  calendarSettings: "workspace_calendar",
};
export function workspaceChangePort(
  db: DatabaseSync,
  workspaceId: string,
  guard: () => void,
): Pick<
  WorkTransaction,
  "workspaceChanges" | "workspaceEntity" | "workspaceRelatedLinks"
> {
  return {
    workspaceRelatedLinks: async (kind, id) => {
      guard();
      return db
        .prepare(
          "SELECT l.payload FROM knowledge_link l WHERE l.workspace_id=? AND ((json_extract(l.payload,'$.from.kind')=? AND json_extract(l.payload,'$.from.id')=?) OR (json_extract(l.payload,'$.to.kind')=? AND json_extract(l.payload,'$.to.id')=?) OR EXISTS (SELECT 1 FROM library_file f WHERE f.workspace_id=l.workspace_id AND ((json_extract(l.payload,'$.from.kind')='FILE' AND json_extract(l.payload,'$.from.id')=f.id) OR (json_extract(l.payload,'$.to.kind')='FILE' AND json_extract(l.payload,'$.to.id')=f.id)) AND ((?='SPACE' AND json_extract(f.payload,'$.spaceId')=?) OR (?='DOCUMENT' AND json_extract(f.payload,'$.parentDocumentId')=?))))",
        )
        .all(workspaceId, kind, id, kind, id, kind, id, kind, id)
        .map(
          (row) =>
            JSON.parse(
              String(row.payload),
            ) as import("@arclattice/application").KnowledgeLink,
        );
    },
    workspaceChanges: async (after, expectedEpoch, privatePrincipalId) => {
      guard();
      if (!Number.isSafeInteger(after) || after < 0)
        throw new DomainError("VALIDATION_ERROR");
      const epoch = String(
        db.prepare("SELECT epoch FROM workspace_sync_state WHERE id=1").get()
          ?.epoch,
      );
      const latest = Number(
        db
          .prepare(
            "SELECT COALESCE(MAX(seq),0) AS seq FROM workspace_change WHERE workspace_id=?",
          )
          .get(workspaceId)?.seq,
      );
      const recovery =
        after > latest || (!!expectedEpoch && expectedEpoch !== epoch);
      if (recovery)
        return {
          epoch,
          cursor: latest,
          changes: [],
          recovery: true,
          hasMore: false,
        };
      const rows = db
        .prepare(
          "SELECT seq,workspace_id AS workspaceId,collection,entity_id AS entityId,op,version FROM workspace_change WHERE workspace_id=? AND seq>? AND (owner_principal_id IS NULL OR owner_principal_id=?) ORDER BY seq LIMIT 501",
        )
        .all(workspaceId, after, privatePrincipalId ?? null);
      const changes = rows.slice(0, 500) as unknown as WorkspaceChange[];
      return {
        epoch,
        cursor: changes.at(-1)?.seq ?? latest,
        changes,
        recovery: false,
        hasMore: rows.length > 500,
      };
    },
    workspaceEntity: async (collection, entityId, privatePrincipalId) => {
      guard();
      if (collection === "entityMemos") {
        if (!privatePrincipalId) return null;
        const row = db
          .prepare(
            "SELECT payload FROM entity_memo WHERE workspace_id=? AND id=? AND owner_principal_id=?",
          )
          .get(workspaceId, entityId, privatePrincipalId);
        return row ? (JSON.parse(String(row.payload)) as unknown) : null;
      }
      const table = tables[collection];
      if (!table) throw new DomainError("VALIDATION_ERROR");
      const row =
        collection === "calendarSettings"
          ? db
              .prepare(
                "SELECT version,timezone FROM workspace_calendar WHERE workspace_id=?",
              )
              .get(workspaceId)
          : collection === "navigationPreference"
            ? db
                .prepare(
                  "SELECT preference_json FROM user_navigation WHERE workspace_id=? AND principal_id=?",
                )
                .get(workspaceId, entityId)
            : collection === "organization"
              ? db
                  .prepare(
                    "SELECT payload FROM organization WHERE workspace_id=? AND kind=? AND id=?",
                  )
                  .get(
                    workspaceId,
                    entityId.slice(0, entityId.indexOf(":")),
                    entityId.slice(entityId.indexOf(":") + 1),
                  )
              : db
                  .prepare(
                    "SELECT * FROM " + table + " WHERE workspace_id=? AND id=?",
                  )
                  .get(workspaceId, entityId);
      if (!row) return null;
      if (collection === "navigationPreference")
        return JSON.parse(String(row.preference_json));
      if (collection !== "workflows" && row.payload !== undefined) {
        const value = JSON.parse(String(row.payload)) as Record<
          string,
          unknown
        >;
        if (collection === "library")
          value.aliases = [
            ...new Set([
              ...(Array.isArray(value.aliases) ? value.aliases : []),
              ...db
                .prepare(
                  "SELECT alias FROM document_alias WHERE workspace_id=? AND document_id=? ORDER BY normalized_alias",
                )
                .all(workspaceId, entityId)
                .map((entry) => String(entry.alias)),
            ]),
          ];
        if (collection === "projectMaterials") {
          const binding = db
            .prepare(
              "SELECT role,inherit_to_children FROM project_knowledge_binding WHERE workspace_id=? AND id=?",
            )
            .get(workspaceId, entityId);
          if (binding) {
            value.role = binding.role;
            value.inheritToChildren = binding.inherit_to_children === 1;
          }
        }
        return value;
      }
      const value: Record<string, unknown> = Object.fromEntries(
        Object.entries(row).map(([key, entry]) => [
          key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          entry,
        ]),
      );
      if (collection === "workflows") {
        value.payload = JSON.parse(String(row.payload));
        delete value.kind;
      }
      if (collection === "items" && value.type === "TASK")
        value.projectIds = db
          .prepare(
            "SELECT project_id FROM task_project WHERE workspace_id=? AND task_id=? ORDER BY position",
          )
          .all(workspaceId, entityId)
          .map((entry) => entry.project_id);
      return value;
    },
  };
}
