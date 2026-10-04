import type { WorkspaceChange, WorkTransaction } from "@arclattice/application";
import { DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";

const tables: Record<string, string> = {
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
  client: PoolClient,
  workspaceId: string,
  schedule: <T>(operation: () => Promise<T>) => Promise<T>,
): Pick<
  WorkTransaction,
  "workspaceChanges" | "workspaceEntity" | "workspaceRelatedLinks"
> {
  return {
    workspaceRelatedLinks: (kind, id) =>
      schedule(async () => {
        const result = await client.query(
          "SELECT payload FROM arclattice.knowledge_link WHERE workspace_id=$1 AND (((payload::jsonb->'from'->>'kind')=$2 AND (payload::jsonb->'from'->>'id')=$3) OR ((payload::jsonb->'to'->>'kind')=$2 AND (payload::jsonb->'to'->>'id')=$3))",
          [workspaceId, kind, id],
        );
        return result.rows.map(
          (row) =>
            JSON.parse(
              String(row.payload),
            ) as import("@arclattice/application").KnowledgeLink,
        );
      }),
    workspaceChanges: (after, expectedEpoch) =>
      schedule(async () => {
        if (!Number.isSafeInteger(after) || after < 0)
          throw new DomainError("VALIDATION_ERROR");
        const epoch = String(
          (
            await client.query(
              "SELECT epoch FROM arclattice.workspace_sync_state WHERE id=1",
            )
          ).rows[0]?.epoch,
        );
        const latest = Number(
          (
            await client.query(
              "SELECT COALESCE(MAX(seq),0) AS seq FROM arclattice.workspace_change WHERE workspace_id=$1",
              [workspaceId],
            )
          ).rows[0]?.seq,
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
        const rows = (
          await client.query(
            'SELECT seq,workspace_id AS "workspaceId",collection,entity_id AS "entityId",op,version FROM arclattice.workspace_change WHERE workspace_id=$1 AND seq>$2 ORDER BY seq LIMIT 501',
            [workspaceId, after],
          )
        ).rows.map((row) => ({
          ...row,
          seq: Number(row.seq),
          version: Number(row.version),
        }));
        const changes = rows.slice(0, 500) as unknown as WorkspaceChange[];
        return {
          epoch,
          cursor: changes.at(-1)?.seq ?? latest,
          changes,
          recovery: false,
          hasMore: rows.length > 500,
        };
      }),
    workspaceEntity: (collection, entityId) =>
      schedule(async () => {
        const table = tables[collection];
        if (!table) throw new DomainError("VALIDATION_ERROR");
        const row =
          collection === "calendarSettings"
            ? (
                await client.query(
                  "SELECT version,timezone FROM arclattice.workspace_calendar WHERE workspace_id=$1",
                  [workspaceId],
                )
              ).rows[0]
            : collection === "navigationPreference"
              ? (
                  await client.query(
                    "SELECT preference_json FROM arclattice.user_navigation WHERE workspace_id=$1 AND principal_id=$2",
                    [workspaceId, entityId],
                  )
                ).rows[0]
              : collection === "organization"
                ? (
                    await client.query(
                      "SELECT payload FROM arclattice.organization WHERE workspace_id=$1 AND kind=$2 AND id=$3",
                      [
                        workspaceId,
                        entityId.slice(0, entityId.indexOf(":")),
                        entityId.slice(entityId.indexOf(":") + 1),
                      ],
                    )
                  ).rows[0]
                : (
                    await client.query(
                      "SELECT * FROM arclattice." +
                        table +
                        " WHERE workspace_id=$1 AND id=$2",
                      [workspaceId, entityId],
                    )
                  ).rows[0];
        if (!row) return null;
        if (collection === "navigationPreference")
          return typeof row.preference_json === "string"
            ? JSON.parse(row.preference_json)
            : row.preference_json;
        if (collection !== "workflows" && row.payload !== undefined) {
          const value = (
            typeof row.payload === "string"
              ? JSON.parse(row.payload)
              : row.payload
          ) as Record<string, unknown>;
          if (collection === "library")
            value.aliases = [
              ...new Set([
                ...(Array.isArray(value.aliases) ? value.aliases : []),
                ...(
                  await client.query(
                    "SELECT alias FROM arclattice.document_alias WHERE workspace_id=$1 AND document_id=$2 ORDER BY normalized_alias",
                    [workspaceId, entityId],
                  )
                ).rows.map((entry) => String(entry.alias)),
              ]),
            ];
          if (collection === "projectMaterials") {
            const binding = (
              await client.query(
                "SELECT role,inherit_to_children FROM arclattice.project_knowledge_binding WHERE workspace_id=$1 AND id=$2",
                [workspaceId, entityId],
              )
            ).rows[0];
            if (binding) {
              value.role = binding.role;
              value.inheritToChildren = Boolean(binding.inherit_to_children);
            }
          }
          return value;
        }
        const value = Object.fromEntries(
          Object.entries(row).map(([key, entry]) => [
            key.replace(/_([a-z])/g, (_, letter: string) =>
              letter.toUpperCase(),
            ),
            entry instanceof Date
              ? entry.toISOString()
              : key === "version"
                ? Number(entry)
                : entry,
          ]),
        );
        if (collection === "workflows") {
          value.payload = JSON.parse(String(row.payload));
          delete value.kind;
        }
        if (collection === "items" && value.type === "TASK")
          value.projectIds = (
            await client.query(
              "SELECT project_id FROM arclattice.task_project WHERE workspace_id=$1 AND task_id=$2 ORDER BY position",
              [workspaceId, entityId],
            )
          ).rows.map((entry) => entry.project_id);
        return value;
      }),
  };
}
