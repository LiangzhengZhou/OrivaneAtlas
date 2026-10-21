import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import { requireStableUuid } from "./mutation-receipt";
import type { WorkReplayEffect } from "./work-replay-effects";

export interface LocalWorkReplayRequest {
  readonly path: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly body: LocalJson;
}

/** Original intent only. Receipt recovery uses the same bytes, never a regenerated diff. */
export function buildLocalWorkReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    !plan.command ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    ![
      "work.create",
      "work.update",
      "work.delete",
      "edge.create",
      "edge.delete",
    ].includes(plan.command.name) ||
    !plan.mutations.length ||
    plan.mutations.length > 2000 ||
    plan.mutationIds[0] !== plan.id ||
    new Set(plan.mutationIds).size !== plan.mutationIds.length ||
    plan.mutations.length !== plan.mutationIds.length ||
    plan.mutations.some(
      (mutation, index) => mutation.id !== plan.mutationIds[index],
    )
  )
    return null;
  const commandId = requireStableUuid(plan.id, "commandId");
  const actor = plan.mutations[0];
  if (!actor) return null;
  const deviceId = requireStableUuid(actor.deviceId, "deviceId");
  const effects: WorkReplayEffect[] = plan.mutations.map((mutation) => {
    if (
      mutation.commandId !== commandId ||
      mutation.deviceId !== deviceId ||
      mutation.workspaceId !== actor.workspaceId ||
      mutation.principalId !== actor.principalId ||
      !["PENDING", "SENDING"].includes(mutation.state) ||
      !["items", "edges"].includes(mutation.entityType) ||
      !["CREATE", "PATCH", "DELETE"].includes(mutation.operation)
    )
      throw new DomainError("VALIDATION_ERROR", { field: "commandEffects" });
    const baseVersion = mutation.baseVersion ?? 0;
    if (
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0 ||
      (mutation.entityType === "items" && mutation.operation === "DELETE")
    )
      throw new DomainError("VALIDATION_ERROR", { field: "commandEffects" });
    if (baseVersion === 0) requireStableUuid(mutation.entityId, "effect.id");
    return {
      collection: mutation.entityType as WorkReplayEffect["collection"],
      id: mutation.entityId,
      op: mutation.operation === "DELETE" ? "DELETE" : "UPSERT",
      baseVersion,
    };
  });
  const original = localObject(localDto(plan.command.input));
  const required = (field: string): LocalJson => {
    const value = original[field];
    if (value === undefined)
      throw new DomainError("VALIDATION_ERROR", { field });
    return value;
  };
  const keys = (allowed: readonly string[]) => {
    if (Object.keys(original).some((key) => !allowed.includes(key)))
      throw new DomainError("VALIDATION_ERROR", { field: "commandInput" });
  };
  let body: Record<string, LocalJson>;
  switch (plan.command.name) {
    case "work.create":
      keys(["id", "input"]);
      body = {
        ...localObject(required("input")),
        stableId: requireStableUuid(original.id, "stableId"),
        deviceId,
      };
      break;
    case "edge.create":
      keys(["id", "fromId", "toId", "type"]);
      body = {
        fromId: required("fromId"),
        toId: required("toId"),
        ...(original.type === undefined ? {} : { type: original.type }),
        stableId: requireStableUuid(original.id, "stableId"),
        deviceId,
      };
      break;
    case "work.update":
      keys(["id", "version", "input"]);
      body = original;
      break;
    case "work.delete":
      keys(["id", "version", "deleted"]);
      body = original;
      break;
    default:
      keys(["id"]);
      body = original;
  }
  return {
    path: "/api/v1/" + plan.command.name.replace(".", "/"),
    idempotencyKey: commandId,
    deviceId,
    body: localDto({ ...body, syncCommand: { commandId, deviceId, effects } }),
  };
}
