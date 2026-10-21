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

export interface EntityMemoReplayEffect {
  readonly collection: "entityMemos";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}

/** Ordinary Memo rules, bounded by one authenticated original command effect. */
export class EntityMemoReplayUnitOfWork implements EntityMemoUnitOfWork {
  private readonly actor: ActorContext;
  private readonly effect: EntityMemoReplayEffect;
  private accepted: EntityMemo | null = null;
  constructor(
    private readonly delegate: EntityMemoUnitOfWork,
    actor: ActorContext,
    effects: readonly EntityMemoReplayEffect[],
  ) {
    this.actor = Object.freeze({ ...actor });
    const effect = effects[0];
    if (
      effects.length !== 1 ||
      !effect ||
      effect.collection !== "entityMemos" ||
      effect.op !== "UPSERT" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        effect.id,
      ) ||
      !Number.isSafeInteger(effect.baseVersion) ||
      effect.baseVersion < 0 ||
      effect.baseVersion >= Number.MAX_SAFE_INTEGER
    )
      throw new DomainError("VALIDATION_ERROR", { field: "memoEffects" });
    this.effect = Object.freeze({ ...effect });
  }
  get acceptedEffects() {
    return this.accepted
      ? [
          {
            collection: "entityMemos" as const,
            id: this.accepted.id,
            op: "UPSERT" as const,
            version: this.accepted.version,
            value: structuredClone(this.accepted),
          },
        ]
      : [];
  }
  async run<T>(
    actor: ActorContext,
    operation: (tx: EntityMemoTransaction) => Promise<T>,
  ): Promise<T> {
    if (
      actor.workspaceId !== this.actor.workspaceId ||
      actor.principalId !== this.actor.principalId
    )
      throw new DomainError("FORBIDDEN");
    this.accepted = null;
    const outcome = await this.delegate.run(actor, async (tx) => {
      let written: EntityMemo | null = null;
      let appended = false;
      const result = await operation({
        target: (target) => tx.target(target),
        find: (owner, target) => tx.find(owner, target),
        replace: async (input, version) => {
          const memo = requireEntityMemoRecord(input);
          requireEntityMemoOwner(this.actor, memo);
          if (
            written ||
            memo.id !== this.effect.id ||
            version !== this.effect.baseVersion ||
            memo.version !== version + 1
          )
            throw new DomainError("VERSION_CONFLICT");
          await tx.replace(memo, version);
          written = memo;
        },
        appendChange: async (change) => {
          if (
            !written ||
            appended ||
            change.workspaceId !== this.actor.workspaceId ||
            change.principalId !== this.actor.principalId ||
            change.memoId !== this.effect.id ||
            change.version !== this.effect.baseVersion + 1
          )
            throw new DomainError("VERSION_CONFLICT");
          await tx.appendChange(change);
          appended = true;
        },
      });
      if (!written || !appended) throw new DomainError("VERSION_CONFLICT");
      return { result, memo: written };
    });
    this.accepted = outcome.memo;
    return outcome.result;
  }
}
