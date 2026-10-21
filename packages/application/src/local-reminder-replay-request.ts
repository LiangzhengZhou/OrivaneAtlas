import {
  DomainError,
  type ReminderInput,
  requireReminder,
} from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

/** Serialize the captured original command, never the current Reminder projection. */
export function buildLocalReminderReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    plan.command?.name !== "reminder.save" ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    plan.mutations.length !== 1 ||
    plan.mutationIds.length !== 1 ||
    plan.mutationIds[0] !== plan.id
  )
    return null;
  const mutation = plan.mutations[0];
  if (!mutation) return null;
  const commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(mutation.deviceId, "deviceId");
  const original = localObject(plan.command.input);
  if (
    mutation.id !== plan.id ||
    mutation.commandId !== commandId ||
    mutation.entityType !== "reminders" ||
    !["CREATE", "PATCH"].includes(mutation.operation) ||
    !["PENDING", "SENDING"].includes(mutation.state) ||
    Object.keys(original).some(
      (key) => !["id", "version", "create", "input", "deleted"].includes(key),
    ) ||
    typeof original.id !== "string" ||
    original.id !== mutation.entityId ||
    typeof original.version !== "number" ||
    !Number.isSafeInteger(original.version) ||
    original.version < 0 ||
    original.version !== (mutation.baseVersion ?? 0) ||
    typeof original.create !== "boolean" ||
    typeof original.deleted !== "boolean" ||
    original.input === undefined ||
    (original.create && original.version !== 0)
  )
    throw new DomainError("VALIDATION_ERROR", { field: "reminderCommand" });
  const value = localObject(original.input);
  const normalized = requireReminder(value as unknown as ReminderInput);
  if (!equalLocalJson(localDto(normalized), value))
    throw new DomainError("VALIDATION_ERROR", { field: "reminderCommand" });
  return {
    path: "/api/v1/reminders/save",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      id: original.create ? null : original.id,
      version: original.version,
      input: value,
      deleted: original.deleted,
      ...(original.create
        ? { stableId: requireStableUuid(original.id, "stableId"), deviceId }
        : {}),
      syncCommand: {
        commandId,
        deviceId,
        effects: [
          {
            collection: "reminders",
            id: original.id,
            op: "UPSERT",
            baseVersion: original.version,
          },
        ],
      },
    }),
  };
}
