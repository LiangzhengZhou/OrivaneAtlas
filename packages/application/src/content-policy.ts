import {
  DomainError,
  dataClassifications,
  type ProcessingData,
  processingBoundaries,
} from "@arclattice/domain";

export type ContentPolicy = Pick<
  ProcessingData,
  "classification" | "processingBoundary" | "aiAccess"
>;
export const privateContentPolicy: ContentPolicy = {
  classification: "PRIVATE",
  processingBoundary: "LOCAL_ONLY",
  aiAccess: "DENY",
};

/** Only call for human-authorized metadata edits. Absent input preserves policy. */
export function contentPolicy(
  input: ContentPolicy | undefined,
  previous?: ContentPolicy,
): ContentPolicy {
  const value =
    input === undefined ? (previous ?? privateContentPolicy) : input;
  if (
    !value ||
    typeof value !== "object" ||
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
