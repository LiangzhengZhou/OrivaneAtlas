import {
  type ActorContext,
  DomainError,
  type EntityMemo,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type { ModelRoute } from "./connected";
import { type ContentPolicy, contentPolicy } from "./content-policy";
import type { EntityMemoService, EntityMemoTarget } from "./entity-memos";
import { validateContextPolicy } from "./model-gateway";

/** Private AI source identity deliberately does not extend KnowledgeLink EntityRef. */
export interface MemoAiContext {
  ref: { kind: "MEMO"; id: string; target: EntityMemoTarget };
  ownerPrincipalId: string;
  target: EntityMemoTarget;
  version: number;
  bodyMd: string;
  permission: ContentPolicy;
}

/** Call only after explicit invocation. This reads no unrelated Memo or Document.
 * Approval and execution must call recheck with the current authorized service. */
export class MemoAiContextService {
  constructor(
    private readonly memos: Pick<EntityMemoService, "get">,
    private readonly requireFileContext?: (
      actor: ActorContext,
      fileId: string,
      route: ModelRoute,
    ) => Promise<void>,
  ) {}

  private async read(
    actor: ActorContext,
    target: EntityMemoTarget,
    route: ModelRoute,
  ): Promise<EntityMemo> {
    const value = await this.memos.get(actor, target);
    if (!value) throw new DomainError("NOT_FOUND");
    const memo = requireEntityMemoRecord(value);
    requireEntityMemoOwner(actor, memo);
    if (
      memo.targetKind !== target.targetKind ||
      memo.targetId !== target.targetId
    )
      throw new DomainError("FORBIDDEN");
    if (memo.targetKind === "FILE") {
      if (!this.requireFileContext) throw new DomainError("FORBIDDEN");
      await this.requireFileContext(actor, memo.targetId, route);
    }
    // No target read scope or per-run approval can override DENY / local-only.
    validateContextPolicy(actor, route, memo);
    return memo;
  }

  async select(
    actorInput: ActorContext,
    targetInput: EntityMemoTarget,
    version: number,
    routeInput: ModelRoute,
  ): Promise<MemoAiContext> {
    const actor = { ...actorInput },
      target = { ...targetInput },
      route = structuredClone(routeInput);
    if (!Number.isSafeInteger(version) || version < 1)
      throw new DomainError("VALIDATION_ERROR");
    const memo = await this.read(actor, target, route);
    if (memo.version !== version) throw new DomainError("VERSION_CONFLICT");
    return {
      ref: { kind: "MEMO", id: memo.id, target: { ...target } },
      ownerPrincipalId: memo.ownerPrincipalId,
      target,
      version,
      bodyMd: memo.bodyMd,
      permission: contentPolicy(memo.aiPolicy),
    };
  }

  async recheck(
    actorInput: ActorContext,
    sourceInput: MemoAiContext,
    routeInput: ModelRoute,
  ): Promise<void> {
    const actor = { ...actorInput },
      source = structuredClone(sourceInput),
      route = structuredClone(routeInput);
    if (
      source.ref.kind !== "MEMO" ||
      source.ref.target.targetKind !== source.target.targetKind ||
      source.ref.target.targetId !== source.target.targetId ||
      source.ownerPrincipalId !== actor.principalId
    )
      throw new DomainError("FORBIDDEN");
    const memo = await this.read(actor, source.target, route);
    if (
      source.ref.id !== memo.id ||
      source.version !== memo.version ||
      source.bodyMd !== memo.bodyMd
    )
      throw new DomainError("VERSION_CONFLICT");
  }
}
