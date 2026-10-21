import {
  dataClassifications,
  type ProcessingData,
  processingBoundaries,
} from "./data-policy";
import { type ActorContext, DomainError } from "./index";

export type EntityMemoPolicy = Pick<
  ProcessingData,
  "classification" | "processingBoundary" | "aiAccess"
>;

/** An explicit owner metadata policy; absence remains private/local-only/denied. */
export function requireEntityMemoPolicy(input: unknown): EntityMemoPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as EntityMemoPolicy;
  if (
    Object.keys(value).some(
      (key) =>
        !["classification", "processingBoundary", "aiAccess"].includes(key),
    ) ||
    !dataClassifications.includes(value.classification) ||
    !processingBoundaries.includes(value.processingBoundary) ||
    !["ALLOW", "ASK", "DENY"].includes(value.aiAccess)
  )
    throw new DomainError("VALIDATION_ERROR");
  return {
    classification: value.classification,
    processingBoundary: value.processingBoundary,
    aiAccess: value.aiAccess,
  };
}

export const entityMemoTargetKinds = [
  "PROJECT",
  "TASK",
  "MILESTONE",
  "FILE",
] as const;
export type EntityMemoTargetKind = (typeof entityMemoTargetKinds)[number];

/** Personal scratchpad, independent of Document and the target's description. */
export interface EntityMemo {
  readonly aiPolicy?: EntityMemoPolicy;
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerPrincipalId: string;
  readonly targetKind: EntityMemoTargetKind;
  readonly targetId: string;
  readonly bodyMd: string;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly deletedAt: string | null;
}

export interface EntityMemoInput {
  readonly aiPolicy?: EntityMemoPolicy;
  readonly targetKind: EntityMemoTargetKind;
  readonly targetId: string;
  readonly bodyMd: string;
}

/** Validate durable/canonical records before any private body leaves a port. */
export function requireEntityMemoRecord(input: unknown): EntityMemo {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as Record<string, unknown>;
  const fields = [
    "id",
    "workspaceId",
    "ownerPrincipalId",
    "targetKind",
    "targetId",
    "bodyMd",
    "version",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "deletedAt",
  ];
  if (
    Object.keys(value).some(
      (key) => key !== "aiPolicy" && !fields.includes(key),
    ) ||
    fields.some((key) => !Object.hasOwn(value, key)) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1
  )
    throw new DomainError("VALIDATION_ERROR");
  for (const key of [
    "id",
    "workspaceId",
    "ownerPrincipalId",
    "createdBy",
    "updatedBy",
  ])
    if (
      typeof value[key] !== "string" ||
      !value[key].trim() ||
      value[key].length > 240
    )
      throw new DomainError("VALIDATION_ERROR");
  if (
    value.createdBy !== value.ownerPrincipalId ||
    value.updatedBy !== value.ownerPrincipalId
  )
    throw new DomainError("VALIDATION_ERROR");
  for (const key of ["createdAt", "updatedAt"])
    if (
      typeof value[key] !== "string" ||
      !Number.isFinite(Date.parse(value[key]))
    )
      throw new DomainError("VALIDATION_ERROR");
  if (
    value.deletedAt !== null &&
    (typeof value.deletedAt !== "string" ||
      !Number.isFinite(Date.parse(value.deletedAt)))
  )
    throw new DomainError("VALIDATION_ERROR");
  requireEntityMemoInput(value as unknown as EntityMemoInput);
  return {
    ...(value as unknown as EntityMemo),
    ...(Object.hasOwn(value, "aiPolicy")
      ? { aiPolicy: requireEntityMemoPolicy(value.aiPolicy) }
      : {}),
  };
}

export function requireEntityMemoInput(
  input: EntityMemoInput,
): EntityMemoInput {
  if (
    !input ||
    !entityMemoTargetKinds.includes(input.targetKind) ||
    typeof input.targetId !== "string" ||
    !input.targetId.trim() ||
    input.targetId.length > 240 ||
    typeof input.bodyMd !== "string" ||
    input.bodyMd.length > 100000
  )
    throw new DomainError("VALIDATION_ERROR");
  // Preserve Markdown exactly, including leading/trailing whitespace and images.
  return {
    targetKind: input.targetKind,
    targetId: input.targetId,
    bodyMd: input.bodyMd,
    ...(Object.hasOwn(input, "aiPolicy")
      ? { aiPolicy: requireEntityMemoPolicy(input.aiPolicy) }
      : {}),
  };
}

/** Target access alone never grants another principal's private memo content. */
export function requireEntityMemoOwner(
  context: ActorContext,
  memo: EntityMemo,
): void {
  if (
    !context.workspaceId ||
    !context.principalId ||
    memo.workspaceId !== context.workspaceId ||
    memo.ownerPrincipalId !== context.principalId
  )
    throw new DomainError("FORBIDDEN");
}

/** Tuple encoding avoids separator collisions; identity derivation lives in a port. */
export function entityMemoOwnerKey(
  workspaceId: string,
  ownerPrincipalId: string,
  targetKind: EntityMemoTargetKind,
  targetId: string,
): string {
  if (!workspaceId || !ownerPrincipalId)
    throw new DomainError("VALIDATION_ERROR");
  requireEntityMemoInput({ targetKind, targetId, bodyMd: "" });
  return JSON.stringify([workspaceId, ownerPrincipalId, targetKind, targetId]);
}
