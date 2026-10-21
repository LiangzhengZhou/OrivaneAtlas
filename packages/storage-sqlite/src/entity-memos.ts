import type { DatabaseSync } from "node:sqlite";
import type { EntityMemoTransaction } from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  type EntityMemo,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";

/** Used only within the existing authenticated request transaction. */
export function entityMemoStore(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): EntityMemoTransaction {
  return {
    target: async (target) => {
      guard();
      if (target.targetKind === "FILE") {
        const row = db
          .prepare(
            "SELECT payload FROM library_file WHERE workspace_id=? AND id=?",
          )
          .get(context.workspaceId, target.targetId);
        if (!row) return null;
        const file = JSON.parse(String(row.payload)) as {
          deletedAt: string | null;
        };
        return { deleted: file.deletedAt !== null };
      }
      const row = db
        .prepare(
          "SELECT type,deleted_at FROM work_item WHERE workspace_id=? AND id=?",
        )
        .get(context.workspaceId, target.targetId);
      return row?.type === target.targetKind
        ? { deleted: row.deleted_at !== null }
        : null;
    },
    find: async (owner, target) => {
      guard();
      if (owner !== context.principalId) throw new DomainError("FORBIDDEN");
      const row = db
        .prepare(
          "SELECT payload FROM entity_memo WHERE workspace_id=? AND owner_principal_id=? AND target_kind=? AND target_id=?",
        )
        .get(context.workspaceId, owner, target.targetKind, target.targetId);
      if (!row) return null;
      const memo = requireEntityMemoRecord(JSON.parse(String(row.payload)));
      requireEntityMemoOwner(context, memo);
      return memo;
    },
    replace: async (memo, expected) => {
      guard();
      requireEntityMemoOwner(context, memo);
      if (memo.version !== expected + 1)
        throw new DomainError("VERSION_CONFLICT");
      const row = db
        .prepare(
          "SELECT payload FROM entity_memo WHERE workspace_id=? AND id=?",
        )
        .get(context.workspaceId, memo.id);
      if (row) {
        const previous = JSON.parse(String(row.payload)) as EntityMemo;
        requireEntityMemoOwner(context, previous);
        if (
          previous.targetKind !== memo.targetKind ||
          previous.targetId !== memo.targetId
        )
          throw new DomainError("FORBIDDEN");
      }
      const payload = JSON.stringify(memo);
      const result =
        expected === 0
          ? db
              .prepare(
                "INSERT INTO entity_memo(workspace_id,id,owner_principal_id,target_kind,target_id,version,payload) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
              )
              .run(
                context.workspaceId,
                memo.id,
                context.principalId,
                memo.targetKind,
                memo.targetId,
                memo.version,
                payload,
              )
          : db
              .prepare(
                "UPDATE entity_memo SET version=?,payload=? WHERE workspace_id=? AND id=? AND owner_principal_id=? AND version=?",
              )
              .run(
                memo.version,
                payload,
                context.workspaceId,
                memo.id,
                context.principalId,
                expected,
              );
      if (result.changes !== 1) throw new DomainError("VERSION_CONFLICT");
    },
    appendChange: async (change) => {
      guard();
      if (
        change.workspaceId !== context.workspaceId ||
        change.principalId !== context.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !db
          .prepare(
            "SELECT 1 FROM entity_memo WHERE workspace_id=? AND id=? AND owner_principal_id=? AND version=?",
          )
          .get(
            context.workspaceId,
            change.memoId,
            context.principalId,
            change.version,
          )
      )
        throw new DomainError("VERSION_CONFLICT");
      db.prepare(
        "INSERT INTO entity_memo_activity(workspace_id,id,payload) VALUES (?,?,?)",
      ).run(context.workspaceId, change.id, JSON.stringify(change));
      db.prepare(
        "INSERT INTO entity_memo_outbox(workspace_id,event_id) VALUES (?,?)",
      ).run(context.workspaceId, change.id);
    },
  };
}
