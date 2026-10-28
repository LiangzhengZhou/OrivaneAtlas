import {
  activationPolicies,
  activationStates,
  DomainError,
  edgeTypes,
  priorities,
  projectLifecycles,
  validateSchedule,
  workStatuses,
  workTypes,
} from "@arclattice/domain";
import { localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";

function invalid(): never {
  throw new DomainError("VALIDATION_ERROR", { field: "canonicalWork" });
}
/** Shared boundary validation for canonical Work receipts and remote delta projection. */
export function validateLocalCanonicalWorkValue(
  collection: "items" | "edges",
  id: string,
  remoteWorkspaceId: string,
  version: number,
  value: LocalJson,
): void {
  if (!Number.isSafeInteger(version) || version < 1) invalid();
  const entity = localObject(value);
  if (
    entity.id !== id ||
    entity.workspaceId !== remoteWorkspaceId ||
    typeof entity.createdBy !== "string" ||
    typeof entity.createdAt !== "string"
  )
    invalid();
  if (collection === "items") {
    if (
      entity.version !== version ||
      typeof entity.title !== "string" ||
      typeof entity.descriptionMd !== "string" ||
      typeof entity.type !== "string" ||
      typeof entity.updatedBy !== "string" ||
      typeof entity.updatedAt !== "string"
    )
      invalid();
    for (const [field, allowed] of [
      ["type", workTypes],
      ["status", workStatuses],
      ["priority", priorities],
      ["activationState", activationStates],
      ["activationPolicy", activationPolicies],
    ] as const) {
      const value = entity[field];
      if (
        typeof value !== "string" ||
        !(allowed as readonly string[]).includes(value)
      )
        invalid();
    }
    if (
      entity.lifecycle !== null &&
      (typeof entity.lifecycle !== "string" ||
        !(projectLifecycles as readonly string[]).includes(entity.lifecycle))
    )
      invalid();
    for (const field of [
      "assigneePrincipalId",
      "parentProjectId",
      "categoryId",
      "startDate",
      "dueDate",
      "completedAt",
      "deletedAt",
    ]) {
      if (entity[field] !== null && typeof entity[field] !== "string")
        invalid();
    }
    if (
      entity.projectIds !== undefined &&
      (!Array.isArray(entity.projectIds) ||
        entity.projectIds.some((id) => typeof id !== "string"))
    )
      invalid();
    if (
      entity.timerStartedAt !== undefined &&
      entity.timerStartedAt !== null &&
      (typeof entity.timerStartedAt !== "string" ||
        !Number.isFinite(Date.parse(entity.timerStartedAt)))
    )
      invalid();
    if (
      entity.timerAccumulatedMs !== undefined &&
      (typeof entity.timerAccumulatedMs !== "number" ||
        !Number.isSafeInteger(entity.timerAccumulatedMs) ||
        entity.timerAccumulatedMs < 0)
    )
      invalid();
    validateSchedule(
      entity.startDate as string | null,
      entity.dueDate as string | null,
      (entity.dueTime ?? null) as string | null,
    );
  } else if (
    typeof entity.fromId !== "string" ||
    typeof entity.toId !== "string" ||
    typeof entity.type !== "string"
  )
    invalid();
  else if (!(edgeTypes as readonly string[]).includes(entity.type as string))
    invalid();
}
