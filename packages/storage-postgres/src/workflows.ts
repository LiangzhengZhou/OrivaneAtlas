import type { WorkflowRecord, WorkTransaction } from "@arclattice/application";
import { DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";
export function workflowPort(
  client: PoolClient,
  workspaceId: string,
  schedule: <T>(operation: () => Promise<T>) => Promise<T>,
): Pick<WorkTransaction, "workflows" | "saveWorkflow"> {
  return {
    workflows: () =>
      schedule(async () =>
        (
          await client.query(
            'SELECT id,workspace_id AS "workspaceId",version,created_by AS "createdBy",updated_by AS "updatedBy",created_at AS "createdAt",updated_at AS "updatedAt",deleted_at AS "deletedAt",payload FROM arclattice.workflow_record WHERE workspace_id=$1 ORDER BY created_at,id',
            [workspaceId],
          )
        ).rows.map(
          (row) =>
            ({ ...row, payload: JSON.parse(row.payload) }) as WorkflowRecord,
        ),
      ),
    saveWorkflow: (record, expected) => {
      const r = structuredClone(record);
      return schedule(async () => {
        if (r.workspaceId !== workspaceId) throw new DomainError("FORBIDDEN");
        if (r.version !== expected + 1)
          throw new DomainError("VERSION_CONFLICT");
        const old = (
          await client.query(
            "SELECT version,created_by,created_at,kind FROM arclattice.workflow_record WHERE workspace_id=$1 AND id=$2",
            [workspaceId, r.id],
          )
        ).rows[0];
        if ((old?.version ?? 0) !== expected)
          throw new DomainError("VERSION_CONFLICT");
        if (
          old &&
          (old.created_by !== r.createdBy ||
            old.created_at !== r.createdAt ||
            old.kind !== r.payload.kind)
        )
          throw new DomainError("VALIDATION_ERROR");
        const result = !old
          ? await client.query(
              "INSERT INTO arclattice.workflow_record VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING",
              [
                workspaceId,
                r.id,
                r.payload.kind,
                r.version,
                r.createdBy,
                r.updatedBy,
                r.createdAt,
                r.updatedAt,
                r.deletedAt,
                JSON.stringify(r.payload),
              ],
            )
          : await client.query(
              "UPDATE arclattice.workflow_record SET version=$1,updated_by=$2,updated_at=$3,deleted_at=$4,payload=$5 WHERE workspace_id=$6 AND id=$7 AND version=$8",
              [
                r.version,
                r.updatedBy,
                r.updatedAt,
                r.deletedAt,
                JSON.stringify(r.payload),
                workspaceId,
                r.id,
                expected,
              ],
            );
        if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
        await client.query(
          "INSERT INTO arclattice.workflow_activity VALUES ($1,$2,$3,$4,$5)",
          [workspaceId, r.id, r.version, r.updatedBy, r.updatedAt],
        );
        await client.query(
          "INSERT INTO arclattice.workflow_outbox VALUES ($1,$2,$3)",
          [workspaceId, r.id, r.version],
        );
      });
    },
  };
}
