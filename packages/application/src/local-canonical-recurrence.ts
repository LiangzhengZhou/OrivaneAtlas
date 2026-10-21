import {
  activationPolicies,
  activationStates,
  DomainError,
  priorities,
  requireTitle,
  validateCalendarRule,
} from "@arclattice/domain";
import { localDto, localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import { occurrenceExpiry } from "./recurrence-lifecycle";
import type { RecurrencePayload } from "./workflows";

function invalid(): never {
  throw new DomainError("VALIDATION_ERROR", { field: "canonicalRecurrence" });
}
const timestamp = (value: LocalJson | undefined, nullable = false) =>
  (nullable && value === null) ||
  (typeof value === "string" && Number.isFinite(Date.parse(value)));
function rule(input: LocalJson | undefined): void {
  if (input === undefined) invalid();
  const value = localObject(input);
  if (
    value.kind !== "RECURRENCE" ||
    typeof value.title !== "string" ||
    requireTitle(value.title) !== value.title ||
    typeof value.descriptionMd !== "string" ||
    value.descriptionMd.length > 200000 ||
    (value.state !== undefined &&
      !["ACTIVE", "PAUSED", "ENDED"].some((state) => state === value.state)) ||
    (value.closePolicy !== undefined &&
      !["END_OF_DAY", "NEXT_OCCURRENCE", "DURATION"].some(
        (policy) => policy === value.closePolicy,
      )) ||
    (value.closeIncomplete !== undefined &&
      typeof value.closeIncomplete !== "boolean") ||
    (value.projectIds !== undefined &&
      (!Array.isArray(value.projectIds) ||
        value.projectIds.some((id) => typeof id !== "string" || !id) ||
        new Set(value.projectIds).size !== value.projectIds.length)) ||
    (value.activationState !== undefined &&
      !activationStates.some((state) => state === value.activationState)) ||
    (value.activationPolicy !== undefined &&
      !activationPolicies.some(
        (policy) => policy === value.activationPolicy,
      )) ||
    (value.priority !== undefined &&
      !priorities.some((priority) => priority === value.priority)) ||
    (value.assigneePrincipalId !== undefined &&
      value.assigneePrincipalId !== null &&
      (typeof value.assigneePrincipalId !== "string" ||
        !value.assigneePrincipalId)) ||
    (value.schedulerThrough !== undefined &&
      (typeof value.schedulerThrough !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.schedulerThrough)))
  )
    invalid();
  validateCalendarRule(value as unknown as RecurrencePayload);
  occurrenceExpiry(
    value as unknown as RecurrencePayload,
    String(value.startDate),
  );
}

/** Reject other workflow families until their own canonical contracts are implemented. */
export function validateLocalCanonicalRecurrenceValue(
  id: string,
  workspaceId: string,
  version: number,
  input: LocalJson,
): void {
  const value = localObject(input);
  if (
    value.id !== id ||
    value.workspaceId !== workspaceId ||
    value.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof value.createdBy !== "string" ||
    !value.createdBy ||
    typeof value.updatedBy !== "string" ||
    !value.updatedBy ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    !timestamp(value.deletedAt, true)
  )
    invalid();
  if (value.payload === undefined) invalid();
  const payload = localObject(value.payload);
  if (payload.kind === "RECURRENCE") {
    rule(value.payload);
    return;
  }
  if (
    payload.kind !== "OCCURRENCE" ||
    typeof payload.definitionId !== "string" ||
    !payload.definitionId ||
    typeof payload.day !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.day) ||
    id !== `occurrence:${payload.definitionId}:${payload.day}` ||
    typeof payload.definitionVersion !== "number" ||
    !Number.isSafeInteger(payload.definitionVersion) ||
    payload.definitionVersion < 1 ||
    !["MISSED", "SKIPPED", "CREATED", "OPEN", "COMPLETED", "BACKFILLED"].some(
      (status) => status === payload.status,
    ) ||
    (payload.taskId !== null &&
      (typeof payload.taskId !== "string" || !payload.taskId)) ||
    !timestamp(payload.completedAt, true) ||
    !timestamp(payload.recordedAt) ||
    !timestamp(payload.backfilledAt, true) ||
    (payload.expiresAt !== undefined && !timestamp(payload.expiresAt)) ||
    (payload.closedAt !== undefined && !timestamp(payload.closedAt, true))
  )
    invalid();
  validateCalendarRule({
    startDate: payload.day as string,
    timezone: "UTC",
    frequency: "DAILY",
    interval: 1,
  });
  if (payload.ruleSnapshot !== undefined) rule(payload.ruleSnapshot);
}

/** Only the explicitly bound remote owner maps to the installation owner. Base remains remote. */
export function projectLocalRecurrence(
  value: LocalJson,
  workspaceId: string,
  principalId: string,
  remotePrincipalId: string,
): LocalJson {
  const record = localObject(value);
  return localDto({
    ...record,
    workspaceId,
    createdBy:
      record.createdBy === remotePrincipalId ? principalId : record.createdBy,
    updatedBy:
      record.updatedBy === remotePrincipalId ? principalId : record.updatedBy,
  });
}
