import {
  type ActorContext,
  DomainError,
  type EntityMemo,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type {
  EntityMemoTransaction,
  EntityMemoUnitOfWork,
} from "./entity-memos";
import type { Clock, IdGenerator } from "./index";
import { localDto, localObject } from "./local-dto";
import { LocalMutationTransaction } from "./local-mutation-transaction";
import type {
  LocalMetadataStore,
  LocalWorkspaceIdentity,
} from "./local-persistence";

/** Durable staging uses the existing atomic business + Activity + Outbox commit.
 * Product/runtime exposure waits for replay and private-owner replication wiring.
 */
export class LocalEntityMemoUnitOfWork implements EntityMemoUnitOfWork {
  constructor(
    private readonly store: LocalMetadataStore,
    private readonly identity: LocalWorkspaceIdentity,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.identity = Object.freeze({ ...identity });
  }

  async run<T>(
    contextInput: ActorContext,
    operation: (tx: EntityMemoTransaction) => Promise<T>,
  ): Promise<T> {
    const context = Object.freeze({ ...contextInput });
    if (
      context.workspaceId !== this.identity.workspaceId ||
      context.principalId !== this.identity.principalId
    )
      throw new DomainError("FORBIDDEN");
    const stage = await LocalMutationTransaction.begin(
      this.store,
      context,
      this.identity.deviceId,
      this.clock,
      this.ids,
    );
    const changes: { memoId: string; version: number }[] = [];
    try {
      const result = await operation(
        localEntityMemoTransaction(stage, context, (change) =>
          changes.push(change),
        ),
      );
      if (changes.length) {
        const cursor = await stage.get("$local.changes", "cursor");
        const seq = cursor ? localObject(cursor.value).seq : 0;
        if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0)
          throw new Error("LOCAL_DATA_CORRUPT");
        for (const [index, change] of changes.entries())
          stage.stageInternal(
            {
              workspaceId: context.workspaceId,
              collection: "$local.changeLog",
              id: String(seq + index + 1),
              version: 1,
              value: localDto({
                seq: seq + index + 1,
                workspaceId: context.workspaceId,
                collection: "entityMemos",
                entityId: change.memoId,
                version: change.version,
                op: "UPSERT",
              }),
            },
            null,
          );
        stage.stageInternal(
          {
            workspaceId: context.workspaceId,
            collection: "$local.changes",
            id: "cursor",
            version: (cursor?.version ?? 0) + 1,
            value: { seq: seq + changes.length },
          },
          cursor?.version ?? null,
        );
        // Capture the original private edit in the same durable transaction.
        // Replay must map the owner through a reviewed binding; no owner from
        // this command is accepted as remote authorization.
        if (changes.length !== 1) throw new Error("LOCAL_DATA_CORRUPT");
        const changed = changes[0]!;
        const record = await stage.get("entityMemos", changed.memoId);
        if (!record || record.version !== changed.version)
          throw new Error("LOCAL_DATA_CORRUPT");
        const memo = record.value as unknown as EntityMemo;
        requireEntityMemoOwner(context, memo);
        stage.recordCommand({
          name: "memo.save",
          input: localDto({
            id: memo.id,
            version: memo.version - 1,
            input: {
              targetKind: memo.targetKind,
              targetId: memo.targetId,
              bodyMd: memo.bodyMd,
              ...(memo.aiPolicy ? { aiPolicy: memo.aiPolicy } : {}),
            },
            deleted: memo.deletedAt !== null,
          }),
        });
      }
      await stage.commit();
      return structuredClone(result);
    } catch (error) {
      stage.abort();
      throw error;
    }
  }
}

/** Shared port inside an already-staged Application transaction. */
export function localEntityMemoTransaction(
  stage: LocalMutationTransaction,
  actor: ActorContext,
  onChange: (change: { memoId: string; version: number }) => void,
): EntityMemoTransaction {
  const context = Object.freeze({ ...actor });
  return {
    target: async (ref) => {
      const row = await stage.get(
        ref.targetKind === "FILE" ? "files" : "items",
        ref.targetId,
      );
      if (!row) return null;
      const value = localObject(row.value);
      if (value.localTombstone === true) return null;
      if (
        value.workspaceId !== context.workspaceId ||
        value.version !== row.version
      )
        throw new Error("LOCAL_DATA_CORRUPT");
      if (ref.targetKind !== "FILE" && value.type !== ref.targetKind)
        return null;
      return { deleted: value.deletedAt !== null };
    },
    find: async (owner, ref) => {
      if (owner !== context.principalId) throw new DomainError("FORBIDDEN");
      const matches = (await stage.list("entityMemos")).filter((row) => {
        const value = localObject(row.value);
        return (
          value.ownerPrincipalId === owner &&
          value.targetKind === ref.targetKind &&
          value.targetId === ref.targetId &&
          value.localTombstone !== true
        );
      });
      if (matches.length > 1) throw new Error("LOCAL_DATA_CORRUPT");
      const row = matches[0];
      if (!row) return null;
      const memo = requireEntityMemoRecord(row.value);
      requireEntityMemoOwner(context, memo);
      if (row.version !== memo.version) throw new Error("LOCAL_DATA_CORRUPT");
      return structuredClone(memo);
    },
    replace: async (memo, expectedVersion) => {
      requireEntityMemoOwner(context, memo);
      const previous = await stage.get("entityMemos", memo.id);
      if (
        (previous?.version ?? 0) !== expectedVersion ||
        memo.version !== expectedVersion + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      if (previous) {
        const old = previous.value as unknown as EntityMemo;
        requireEntityMemoOwner(context, old);
        if (
          old.targetKind !== memo.targetKind ||
          old.targetId !== memo.targetId
        )
          throw new DomainError("FORBIDDEN");
      }
      stage.stage(
        {
          workspaceId: context.workspaceId,
          collection: "entityMemos",
          id: memo.id,
          version: memo.version,
          value: localDto(memo),
        },
        previous?.version ?? null,
        previous ? "PATCH" : "CREATE",
        localDto(memo),
        previous?.value ?? null,
      );
    },
    appendChange: async (change) => {
      if (
        change.workspaceId !== context.workspaceId ||
        change.principalId !== context.principalId
      )
        throw new DomainError("FORBIDDEN");
      stage.stageInternal(
        {
          workspaceId: context.workspaceId,
          collection: "$local.entityMemosActivity",
          id: change.id,
          version: 1,
          value: localDto(change),
        },
        null,
      );
      onChange({ memoId: change.memoId, version: change.version });
    },
  };
}
