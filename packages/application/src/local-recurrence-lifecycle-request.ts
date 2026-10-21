import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";
import {
  type RecurrenceReplayEffect,
  requireRecurrenceCreationId,
} from "./recurrence-replay-effects";

function invalid(): never {
  throw new DomainError("VALIDATION_ERROR", { field: "recurrenceCommand" });
}
export function buildLocalRecurrenceLifecycleRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    !plan.command ||
    ![
      "recurrence.generate",
      "recurrence.skip",
      "recurrence.backfill",
      "recurrence.task",
    ].includes(plan.command.name) ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    !plan.mutations.length ||
    plan.mutations.length > 2000 ||
    plan.mutations.length !== plan.mutationIds.length ||
    plan.mutationIds[0] !== plan.id ||
    new Set(plan.mutationIds).size !== plan.mutationIds.length ||
    plan.mutations.some(
      (mutation, index) => mutation.id !== plan.mutationIds[index],
    )
  )
    return null;
  const first = plan.mutations[0]!,
    commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(first.deviceId, "deviceId"),
    versions = new Map<string, number>();
  const effects: RecurrenceReplayEffect[] = plan.mutations.map((mutation) => {
    const baseVersion = mutation.baseVersion ?? 0,
      identity = JSON.stringify([mutation.entityType, mutation.entityId]);
    if (
      mutation.commandId !== commandId ||
      mutation.workspaceId !== first.workspaceId ||
      mutation.principalId !== first.principalId ||
      mutation.deviceId !== deviceId ||
      !["workflows", "items"].includes(mutation.entityType) ||
      !["PENDING", "SENDING"].includes(mutation.state) ||
      !["CREATE", "PATCH"].includes(mutation.operation) ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0 ||
      (versions.has(identity) && versions.get(identity) !== baseVersion)
    )
      invalid();
    if (!baseVersion)
      requireRecurrenceCreationId(mutation.entityType, mutation.entityId);
    versions.set(identity, baseVersion + 1);
    return {
      collection: mutation.entityType as "items" | "workflows",
      id: mutation.entityId,
      op: "UPSERT",
      baseVersion,
    };
  });
  const workflows = effects.filter(
      (effect) => effect.collection === "workflows",
    ),
    original = localObject(plan.command.input),
    name = plan.command.name.slice("recurrence.".length);
  if (!workflows.length) invalid();
  let body = original;
  if (name === "task") {
    if (
      Object.keys(original).some(
        (key) => !["definitionId", "input"].includes(key),
      )
    )
      invalid();
    const value = localObject(original.input ?? null),
      recurrence = localObject(value.recurrence ?? null),
      definition = workflows.find(
        (effect) => effect.id === original.definitionId,
      );
    if (
      !definition ||
      recurrence.version !== definition.baseVersion ||
      typeof recurrence.deleted !== "boolean" ||
      (definition.baseVersion === 0
        ? Object.hasOwn(recurrence, "id") || recurrence.deleted
        : recurrence.id !== definition.id) ||
      Object.keys(recurrence).some(
        (key) => !["id", "version", "deleted", "rule"].includes(key),
      ) ||
      Object.keys(value).some(
        (key) => !["task", "draft", "recurrence"].includes(key),
      ) ||
      workflows.some(
        (effect) =>
          effect.id !== definition.id &&
          !effect.id.startsWith(`occurrence:${definition.id}:`),
      )
    )
      invalid();
    const rule = localObject(recurrence.rule ?? null);
    if (Object.hasOwn(rule, "schedulerThrough")) invalid();
    body = {
      ...value,
      ...(definition.baseVersion === 0
        ? {
            stableDefinitionId: requireStableUuid(
              definition.id,
              "definitionId",
            ),
            deviceId,
          }
        : {}),
    };
  } else {
    const keys =
      name === "generate"
        ? ["id", "version", "from", "to"]
        : name === "backfill"
          ? ["id", "version", "completedAt"]
          : ["id", "version"];
    if (
      Object.keys(original).some((key) => !keys.includes(key)) ||
      typeof original.id !== "string" ||
      typeof original.version !== "number" ||
      !Number.isSafeInteger(original.version) ||
      original.version < 1
    )
      invalid();
    if (name === "generate") {
      if (
        typeof original.from !== "string" ||
        typeof original.to !== "string" ||
        workflows.some(
          (effect) => !effect.id.startsWith(`occurrence:${original.id}:`),
        )
      )
        invalid();
    } else if (
      workflows.length !== 1 ||
      workflows[0]?.id !== original.id ||
      workflows[0]?.baseVersion !== original.version ||
      (name === "backfill" &&
        original.completedAt !== null &&
        typeof original.completedAt !== "string")
    )
      invalid();
  }
  return {
    path: `/api/v1/recurrences/${name}`,
    idempotencyKey: commandId,
    deviceId,
    body: localDto({ ...body, syncCommand: { commandId, deviceId, effects } }),
  };
}
