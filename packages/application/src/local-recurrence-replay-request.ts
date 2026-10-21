import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import { buildLocalRecurrenceLifecycleRequest } from "./local-recurrence-lifecycle-request";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

/** Definition save only; other lifecycle commands remain pending until their guards are wired. */
export function buildLocalRecurrenceReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  if (input.command?.name !== "recurrence.save")
    return buildLocalRecurrenceLifecycleRequest(input);
  const plan = structuredClone(input);
  if (
    plan.command?.name !== "recurrence.save" ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    plan.mutations.length !== 1 ||
    plan.mutationIds.length !== 1 ||
    plan.mutationIds[0] !== plan.id ||
    plan.mutations[0]?.id !== plan.id
  )
    return null;
  const mutation = plan.mutations[0]!,
    original = localObject(plan.command.input),
    value = localObject(original.input ?? null),
    commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(mutation.deviceId, "deviceId"),
    baseVersion = mutation.baseVersion ?? 0;
  if (
    Object.keys(original).some(
      (key) => !["definitionId", "input"].includes(key),
    ) ||
    Object.keys(value).some(
      (key) => !["id", "version", "deleted", "rule"].includes(key),
    ) ||
    mutation.commandId !== commandId ||
    mutation.entityType !== "workflows" ||
    !["PENDING", "SENDING"].includes(mutation.state) ||
    !["CREATE", "PATCH"].includes(mutation.operation) ||
    !Number.isSafeInteger(baseVersion) ||
    baseVersion < 0 ||
    value.version !== baseVersion ||
    original.definitionId !== mutation.entityId ||
    typeof value.deleted !== "boolean" ||
    (baseVersion === 0
      ? Object.hasOwn(value, "id") || value.deleted
      : value.id !== mutation.entityId)
  )
    throw new DomainError("VALIDATION_ERROR", { field: "recurrenceCommand" });
  const rule = localObject(value.rule ?? null);
  if (Object.hasOwn(rule, "schedulerThrough"))
    throw new DomainError("VALIDATION_ERROR", { field: "schedulerThrough" });
  return {
    path: "/api/v1/recurrences/save",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      ...value,
      ...(baseVersion === 0
        ? {
            stableId: requireStableUuid(mutation.entityId, "stableId"),
            deviceId,
          }
        : {}),
      syncCommand: {
        commandId,
        deviceId,
        effects: [
          {
            collection: "workflows",
            id: mutation.entityId,
            op: "UPSERT",
            baseVersion,
          },
        ],
      },
    }),
  };
}
