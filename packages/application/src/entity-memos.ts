import {
  type ActorContext,
  DomainError,
  type EntityMemo,
  type EntityMemoInput,
  requireEntityMemoInput,
  requireEntityMemoOwner,
} from "@arclattice/domain";
import type { AuthorizationService, Clock } from "./index";

export type EntityMemoTarget = Pick<EntityMemoInput, "targetKind" | "targetId">;

/** Adapter must enforce target visibility, including File content policy. */
export interface EntityMemoTransaction {
  target(target: EntityMemoTarget): Promise<{ deleted: boolean } | null>;
  find(
    ownerPrincipalId: string,
    target: EntityMemoTarget,
  ): Promise<EntityMemo | null>;
  replace(memo: EntityMemo, expectedVersion: number): Promise<void>;
  appendChange(change: {
    id: string;
    workspaceId: string;
    principalId: string;
    memoId: string;
    version: number;
    action: "CREATED" | "UPDATED" | "DELETED" | "RESTORED";
    occurredAt: string;
  }): Promise<void>;
}

/** Business row, Activity and Outbox must commit or roll back together. */
export interface EntityMemoUnitOfWork {
  run<T>(
    context: ActorContext,
    operation: (tx: EntityMemoTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface EntityMemoIdentity {
  /** Stable per canonical owner/target; replica adapters explicitly map owners. */
  forTarget(context: ActorContext, target: EntityMemoTarget): Promise<string>;
  nextChangeId(): string;
}

/** Only inside an already authorized, actor-bound transaction. Shared by ordinary
 * Memo reads and Atlas approval/execution so target/owner rules cannot diverge. */
export async function readEntityMemoFromTransaction(
  contextInput: ActorContext,
  targetInput: EntityMemoTarget,
  tx: EntityMemoTransaction,
): Promise<EntityMemo | null> {
  const context = Object.freeze({ ...contextInput });
  const target = requireEntityMemoInput({ ...targetInput, bodyMd: "" });
  const owner = await tx.target(target);
  if (!owner || owner.deleted) return null;
  const memo = await tx.find(context.principalId, target);
  if (memo) requireEntityMemoOwner(context, memo);
  if (
    memo &&
    (memo.targetKind !== target.targetKind || memo.targetId !== target.targetId)
  )
    throw new DomainError("FORBIDDEN");
  return memo?.deletedAt ? null : memo;
}

export class EntityMemoService {
  constructor(
    private readonly uow: EntityMemoUnitOfWork,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: EntityMemoIdentity,
  ) {}

  async get(
    contextInput: ActorContext,
    targetInput: EntityMemoTarget,
  ): Promise<EntityMemo | null> {
    const context = Object.freeze({ ...contextInput });
    const target = requireEntityMemoInput({ ...targetInput, bodyMd: "" });
    await this.authorization.require(context, "work:read");
    return this.uow.run(context, (tx) =>
      readEntityMemoFromTransaction(context, target, tx),
    );
  }

  async save(
    contextInput: ActorContext,
    input: EntityMemoInput,
    expectedVersion: number,
    deleted = false,
  ): Promise<EntityMemo | null> {
    return this.persist(contextInput, input, expectedVersion, deleted, false);
  }

  /** Explicit reviewed copy of an existing source row, including empty text.
   * A destination row must not already exist; ownership is always the actor. */
  async importMemo(context: ActorContext, input: EntityMemoInput) {
    const value = requireEntityMemoInput(input);
    return this.persist(
      context,
      {
        targetKind: value.targetKind,
        targetId: value.targetId,
        bodyMd: value.bodyMd,
      },
      0,
      false,
      true,
    );
  }

  private async persist(
    contextInput: ActorContext,
    input: EntityMemoInput,
    expectedVersion: number,
    deleted: boolean,
    imported: boolean,
  ): Promise<EntityMemo | null> {
    const context = Object.freeze({ ...contextInput });
    const value = requireEntityMemoInput(input);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion >= Number.MAX_SAFE_INTEGER ||
      typeof deleted !== "boolean"
    )
      throw new DomainError("VALIDATION_ERROR");
    await this.authorization.require(context, "work:update");
    return this.uow.run(context, async (tx) => {
      const target = await tx.target(value);
      if (!target || target.deleted) throw new DomainError("NOT_FOUND");
      const previous = await tx.find(context.principalId, value);
      if (previous) requireEntityMemoOwner(context, previous);
      if (
        previous &&
        (previous.targetKind !== value.targetKind ||
          previous.targetId !== value.targetId)
      )
        throw new DomainError("FORBIDDEN");
      if ((previous?.version ?? 0) !== expectedVersion)
        throw new DomainError("VERSION_CONFLICT");
      // Empty scratchpads do not create business rows, commands or activity.
      if (!previous && !imported && (!value.bodyMd.trim() || deleted))
        return null;
      const now = this.clock.now();
      const memo: EntityMemo = {
        ...value,
        ...((value.aiPolicy ?? previous?.aiPolicy)
          ? { aiPolicy: { ...(value.aiPolicy ?? previous!.aiPolicy!) } }
          : {}),
        id: previous?.id ?? (await this.ids.forTarget(context, value)),
        workspaceId: context.workspaceId,
        ownerPrincipalId: context.principalId,
        version: expectedVersion + 1,
        createdAt: previous?.createdAt ?? now,
        createdBy: previous?.createdBy ?? context.principalId,
        updatedAt: now,
        updatedBy: context.principalId,
        deletedAt: deleted ? (previous?.deletedAt ?? now) : null,
      };
      await tx.replace(memo, expectedVersion);
      await tx.appendChange({
        id: this.ids.nextChangeId(),
        workspaceId: context.workspaceId,
        principalId: context.principalId,
        memoId: memo.id,
        version: memo.version,
        action: deleted
          ? "DELETED"
          : previous?.deletedAt
            ? "RESTORED"
            : previous
              ? "UPDATED"
              : "CREATED",
        occurredAt: now,
      });
      return memo;
    });
  }
}
