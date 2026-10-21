import { DomainError, requireCalendarTimezone } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

export function buildLocalCalendarReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    plan.command?.name !== "calendar.settings" ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    plan.mutations.length !== 1 ||
    plan.mutationIds.length !== 1 ||
    plan.mutationIds[0] !== plan.id
  )
    return null;
  const mutation = plan.mutations[0];
  if (!mutation) return null;
  const commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(mutation.deviceId, "deviceId"),
    original = localObject(plan.command.input);
  if (
    mutation.id !== plan.id ||
    mutation.commandId !== commandId ||
    mutation.entityType !== "calendarSettings" ||
    mutation.entityId !== "workspace" ||
    !["CREATE", "PATCH"].includes(mutation.operation) ||
    !["PENDING", "SENDING"].includes(mutation.state) ||
    Object.keys(original).some(
      (key) => !["version", "timezone"].includes(key),
    ) ||
    typeof original.version !== "number" ||
    !Number.isSafeInteger(original.version) ||
    original.version < 0 ||
    original.version !== (mutation.baseVersion ?? 0) ||
    (original.timezone !== null && typeof original.timezone !== "string")
  )
    throw new DomainError("VALIDATION_ERROR", { field: "calendarCommand" });
  if (original.timezone !== null)
    requireCalendarTimezone(original.timezone as string);
  return {
    path: "/api/v1/work/calendar-settings",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      version: original.version,
      timezone: original.timezone,
      syncCommand: {
        commandId,
        deviceId,
        effects: [
          {
            collection: "calendarSettings",
            id: "workspace",
            op: "UPSERT",
            baseVersion: original.version,
          },
        ],
      },
    }),
  };
}
