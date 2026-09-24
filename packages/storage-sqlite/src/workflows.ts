import type { DatabaseSync } from "node:sqlite";
import type { WorkflowRecord, WorkTransaction } from "@arclattice/application";
import { DomainError } from "@arclattice/domain";
export function workflowPort(
  db: DatabaseSync,
  workspaceId: string,
  guard: () => void,
): Pick<WorkTransaction, "workflows" | "saveWorkflow"> {
  return {
    workflows: async () => {
      guard();
      return db
        .prepare(
          "SELECT id,workspace_id AS workspaceId,version,created_by AS createdBy,updated_by AS updatedBy,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt,payload FROM workflow_record WHERE workspace_id=? ORDER BY created_at,id",
        )
        .all(workspaceId)
        .map(
          (row) =>
            ({
              ...row,
              payload: readWorkflowPayload(String(row.payload)),
            }) as WorkflowRecord,
        );
    },
    saveWorkflow: async (r, expected) => {
      guard();
      if (r.workspaceId !== workspaceId) throw new DomainError("FORBIDDEN");
      if (r.version !== expected + 1) throw new DomainError("VERSION_CONFLICT");
      const old = db
        .prepare(
          "SELECT version,created_by,created_at,kind FROM workflow_record WHERE workspace_id=? AND id=?",
        )
        .get(workspaceId, r.id);
      if ((old?.version ?? 0) !== expected)
        throw new DomainError("VERSION_CONFLICT");
      if (
        old &&
        (old.created_by !== r.createdBy ||
          old.created_at !== r.createdAt ||
          old.kind !== r.payload.kind)
      )
        throw new DomainError("VALIDATION_ERROR");
      if (!old)
        db.prepare(
          "INSERT INTO workflow_record VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).run(
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
        );
      else if (
        db
          .prepare(
            "UPDATE workflow_record SET version=?,updated_by=?,updated_at=?,deleted_at=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
          )
          .run(
            r.version,
            r.updatedBy,
            r.updatedAt,
            r.deletedAt,
            JSON.stringify(r.payload),
            workspaceId,
            r.id,
            expected,
          ).changes !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      db.prepare("INSERT INTO workflow_activity VALUES (?,?,?,?,?)").run(
        workspaceId,
        r.id,
        r.version,
        r.updatedBy,
        r.updatedAt,
      );
      db.prepare("INSERT INTO workflow_outbox VALUES (?,?,?)").run(
        workspaceId,
        r.id,
        r.version,
      );
    },
  };
}

function readWorkflowPayload(json: string): WorkflowRecord["payload"] {
  const payload = JSON.parse(json);
  for (const rule of [
    payload,
    payload.ruleSnapshot,
    ...(payload.recurrences ?? []),
  ]) {
    if (rule && (rule.kind === "RECURRENCE" || rule.frequency)) {
      rule.projectIds ??= rule.projectId ? [rule.projectId] : [];
      delete rule.projectId;
    }
  }
  return payload;
}
