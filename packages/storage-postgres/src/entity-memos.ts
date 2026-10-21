import type { EntityMemoTransaction } from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  type EntityMemo,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type { PoolClient } from "pg";

/** Used only within the existing authenticated knowledge transaction. */
export function entityMemoStore(
  client: PoolClient,
  context: ActorContext,
  guard: () => void,
): EntityMemoTransaction {
  return {
    target: async (target) => {
      guard();
      if (target.targetKind === "FILE") {
        const row = (
          await client.query(
            "SELECT payload FROM arclattice.library_file WHERE workspace_id=$1 AND id=$2",
            [context.workspaceId, target.targetId],
          )
        ).rows[0];
        if (!row) return null;
        const file = JSON.parse(String(row.payload)) as {
          deletedAt: string | null;
        };
        return { deleted: file.deletedAt !== null };
      }
      const row = (
        await client.query(
          "SELECT type,deleted_at FROM arclattice.work_item WHERE workspace_id=$1 AND id=$2",
          [context.workspaceId, target.targetId],
        )
      ).rows[0];
      return row?.type === target.targetKind
        ? { deleted: row.deleted_at !== null }
        : null;
    },
    find: async (owner, target) => {
      guard();
      if (owner !== context.principalId) throw new DomainError("FORBIDDEN");
      const row = (
        await client.query(
          "SELECT payload FROM arclattice.entity_memo WHERE workspace_id=$1 AND owner_principal_id=$2 AND target_kind=$3 AND target_id=$4",
          [context.workspaceId, owner, target.targetKind, target.targetId],
        )
      ).rows[0];
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
      const row = (
        await client.query(
          "SELECT payload FROM arclattice.entity_memo WHERE workspace_id=$1 AND id=$2",
          [context.workspaceId, memo.id],
        )
      ).rows[0];
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
          ? await client.query(
              "INSERT INTO arclattice.entity_memo(workspace_id,id,owner_principal_id,target_kind,target_id,version,payload) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
              [
                context.workspaceId,
                memo.id,
                context.principalId,
                memo.targetKind,
                memo.targetId,
                memo.version,
                payload,
              ],
            )
          : await client.query(
              "UPDATE arclattice.entity_memo SET version=$1,payload=$2 WHERE workspace_id=$3 AND id=$4 AND owner_principal_id=$5 AND version=$6",
              [
                memo.version,
                payload,
                context.workspaceId,
                memo.id,
                context.principalId,
                expected,
              ],
            );
      if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
    },
    appendChange: async (change) => {
      guard();
      if (
        change.workspaceId !== context.workspaceId ||
        change.principalId !== context.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !(
          await client.query(
            "SELECT 1 FROM arclattice.entity_memo WHERE workspace_id=$1 AND id=$2 AND owner_principal_id=$3 AND version=$4",
            [
              context.workspaceId,
              change.memoId,
              context.principalId,
              change.version,
            ],
          )
        ).rowCount
      )
        throw new DomainError("VERSION_CONFLICT");
      await client.query(
        "INSERT INTO arclattice.entity_memo_activity(workspace_id,id,payload) VALUES ($1,$2,$3)",
        [context.workspaceId, change.id, JSON.stringify(change)],
      );
      await client.query(
        "INSERT INTO arclattice.entity_memo_outbox(workspace_id,event_id) VALUES ($1,$2)",
        [context.workspaceId, change.id],
      );
    },
  };
}
