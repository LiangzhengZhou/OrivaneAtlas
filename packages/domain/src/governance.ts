/** Versioned, workspace-scoped references; not authentication credentials. */
export interface GovernanceRef {
  readonly id: string;
  readonly workspaceId: string;
  readonly version: number;
}

export interface GovernanceEntity extends GovernanceRef {
  readonly deletedAt: string | null;
}

export const guardrailDecisions = [
  "ALLOW",
  "ALLOW_WITH_WARNING",
  "REQUIRE_APPROVAL",
  "BLOCK",
] as const;
export type GuardrailDecision = (typeof guardrailDecisions)[number];
export type GuardrailStage =
  | "BEFORE_MODEL"
  | "AFTER_MODEL"
  | "BEFORE_TOOL"
  | "AFTER_TOOL";

export type GovernanceReason =
  | "INVALID_POLICY_INPUT"
  | "WORKSPACE_MISMATCH"
  | "DELETED_GOVERNANCE_ENTITY"
  | "NO_GUARDRAIL_CHECKS"
  | "MODEL_NOT_ALLOWED"
  | "EXTERNAL_RUNTIME_UNSUPPORTED"
  | "DATA_NOT_ALLOWED"
  | "AI_ACCESS_DENIED"
  | "AI_ACCESS_APPROVAL_REQUIRED"
  | "SECRET_AI_DENIED"
  | "PROCESSING_BOUNDARY_VIOLATION"
  | "CLOUD_PROVIDER_NOT_TRUSTED"
  | "CONNECTION_REQUIRED"
  | "CONNECTION_ENDPOINT_MISMATCH"
  | "CONNECTION_VERSION_MISMATCH"
  | "DELEGATION_DISABLED"
  | "INTERACTIVE_DELEGATION_DISABLED"
  | "DELEGATION_SCOPE_DENIED"
  | "SELF_DELEGATION_DENIED";

export interface GovernanceResult {
  readonly decision: GuardrailDecision;
  /** Stable codes only: never include document content or credentials. */
  readonly reasons: readonly GovernanceReason[];
}

export function governanceResult(
  decision: GuardrailDecision,
  ...reasons: GovernanceReason[]
): GovernanceResult {
  return { decision, reasons };
}

/** All mandatory checks must be supplied; this does not execute a pipeline. */
export function combineGuardrailDecisions(
  results: readonly GovernanceResult[],
): GovernanceResult {
  if (results.length === 0)
    return governanceResult("BLOCK", "NO_GUARDRAIL_CHECKS");
  let rank = 0;
  const reasons = new Set<GovernanceReason>();
  for (const result of results) {
    const next = guardrailDecisions.indexOf(result.decision);
    if (next < 0) return governanceResult("BLOCK", "INVALID_POLICY_INPUT");
    rank = Math.max(rank, next);
    for (const reason of result.reasons) reasons.add(reason);
  }
  return {
    decision: guardrailDecisions[rank] ?? "BLOCK",
    reasons: [...reasons],
  };
}

export function isNonBlank(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function validGovernanceRef(ref: GovernanceRef): boolean {
  return (
    isNonBlank(ref.id) &&
    isNonBlank(ref.workspaceId) &&
    Number.isSafeInteger(ref.version) &&
    ref.version >= 1
  );
}

/** Internal typed snapshots only; public transports still need schema validation. */
export function checkGovernanceEntities(
  workspaceId: string,
  entities: readonly GovernanceEntity[],
): GovernanceResult {
  if (!isNonBlank(workspaceId) || entities.some((e) => !validGovernanceRef(e)))
    return governanceResult("BLOCK", "INVALID_POLICY_INPUT");
  if (entities.some((e) => e.workspaceId !== workspaceId))
    return governanceResult("BLOCK", "WORKSPACE_MISMATCH");
  // Undefined deletion metadata must not be interpreted as active.
  if (entities.some((e) => e.deletedAt !== null))
    return governanceResult("BLOCK", "DELETED_GOVERNANCE_ENTITY");
  return governanceResult("ALLOW");
}
