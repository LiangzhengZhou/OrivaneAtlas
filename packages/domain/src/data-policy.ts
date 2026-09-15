import {
  checkGovernanceEntities,
  combineGuardrailDecisions,
  type GovernanceEntity,
  type GovernanceResult,
  governanceResult,
  isNonBlank,
} from "./governance";

export const dataClassifications = [
  "PUBLIC",
  "WORKSPACE",
  "PRIVATE",
  "SENSITIVE",
  "SECRET",
] as const;
export type DataClassification = (typeof dataClassifications)[number];
export const processingBoundaries = [
  "LOCAL_ONLY",
  "SELF_HOSTED_ONLY",
  "TRUSTED_CLOUD",
  "ANY",
] as const;
export type ProcessingBoundary = (typeof processingBoundaries)[number];
export const executionLocations = ["LOCAL", "SERVER", "EXTERNAL"] as const;
export type ExecutionLocation = (typeof executionLocations)[number];
export type ModelLocation = "LOCAL" | "SELF_HOSTED" | "CLOUD";
export type ResolvedAiAccess = "ALLOW" | "ASK" | "DENY";

/** Metadata for every input/context revision, loaded by the trusted application. */
export interface ProcessingData extends GovernanceEntity {
  readonly classification: DataClassification;
  readonly processingBoundary: ProcessingBoundary;
  readonly aiAccess: ResolvedAiAccess;
}

/** Minimal exact-ID projection. Hierarchical data scopes are resolved upstream. */
export interface AgentDataPolicy extends GovernanceEntity {
  readonly allowedDataIds: readonly string[];
  readonly trustedCloudProviderIds: readonly string[];
  /** Explicit policy exceptions, NOT per-call approval or model-provided flags. */
  readonly secretAiAllowedDataIds: readonly string[];
}

export interface ModelIdentity {
  readonly providerId: string;
  readonly modelId: string;
}

export interface AgentModelPolicy extends GovernanceEntity {
  readonly allowedModels: readonly ModelIdentity[];
}

/** Location must come from a trusted provider registry, never the model itself. */
export interface ModelRoute extends GovernanceEntity, ModelIdentity {
  readonly location: ModelLocation;
}

export interface ModelProcessingRequest {
  readonly workspaceId: string;
  readonly executionLocation: ExecutionLocation;
  readonly dataPolicy: AgentDataPolicy;
  readonly modelPolicy: AgentModelPolicy;
  readonly route: ModelRoute;
  readonly data: readonly ProcessingData[];
}

/** Evaluate every route (including fallback/embedding) against the entire context.
 * ALLOW only clears this data gate, not Access/Budget/Runtime/Approval checks.
 */
export function evaluateModelProcessing(
  request: ModelProcessingRequest,
): GovernanceResult {
  const {
    workspaceId,
    executionLocation,
    dataPolicy,
    modelPolicy,
    route,
    data,
  } = request;
  const entities = checkGovernanceEntities(workspaceId, [
    dataPolicy,
    modelPolicy,
    route,
    ...data,
  ]);
  if (entities.decision === "BLOCK") return entities;
  if (
    !executionLocations.includes(executionLocation) ||
    !["LOCAL", "SELF_HOSTED", "CLOUD"].includes(route.location) ||
    !isNonBlank(route.providerId) ||
    !isNonBlank(route.modelId) ||
    !dataPolicy.allowedDataIds.every(isNonBlank) ||
    !dataPolicy.trustedCloudProviderIds.every(isNonBlank) ||
    !dataPolicy.secretAiAllowedDataIds.every(isNonBlank) ||
    !modelPolicy.allowedModels.every(
      (model) => isNonBlank(model.providerId) && isNonBlank(model.modelId),
    ) ||
    data.some(
      (item) =>
        !dataClassifications.includes(item.classification) ||
        !processingBoundaries.includes(item.processingBoundary) ||
        !["ALLOW", "ASK", "DENY"].includes(item.aiAccess),
    )
  )
    return governanceResult("BLOCK", "INVALID_POLICY_INPUT");

  const checks: GovernanceResult[] = [entities];
  if (executionLocation === "EXTERNAL")
    checks.push(governanceResult("BLOCK", "EXTERNAL_RUNTIME_UNSUPPORTED"));
  if (
    !modelPolicy.allowedModels.some(
      (model) =>
        model.providerId === route.providerId &&
        model.modelId === route.modelId,
    )
  )
    checks.push(governanceResult("BLOCK", "MODEL_NOT_ALLOWED"));

  for (const item of data) {
    if (!dataPolicy.allowedDataIds.includes(item.id))
      checks.push(governanceResult("BLOCK", "DATA_NOT_ALLOWED"));
    if (item.aiAccess === "DENY")
      checks.push(governanceResult("BLOCK", "AI_ACCESS_DENIED"));
    if (item.aiAccess === "ASK")
      checks.push(
        governanceResult("REQUIRE_APPROVAL", "AI_ACCESS_APPROVAL_REQUIRED"),
      );
    if (
      item.classification === "SECRET" &&
      !dataPolicy.secretAiAllowedDataIds.includes(item.id)
    )
      checks.push(governanceResult("BLOCK", "SECRET_AI_DENIED"));
    if (
      (item.processingBoundary === "LOCAL_ONLY" &&
        (executionLocation !== "LOCAL" || route.location !== "LOCAL")) ||
      (item.processingBoundary === "SELF_HOSTED_ONLY" &&
        (executionLocation === "EXTERNAL" || route.location === "CLOUD"))
    )
      checks.push(governanceResult("BLOCK", "PROCESSING_BOUNDARY_VIOLATION"));
    if (
      item.processingBoundary === "TRUSTED_CLOUD" &&
      route.location === "CLOUD" &&
      !dataPolicy.trustedCloudProviderIds.includes(route.providerId)
    )
      checks.push(governanceResult("BLOCK", "CLOUD_PROVIDER_NOT_TRUSTED"));
  }
  return combineGuardrailDecisions(checks);
}
