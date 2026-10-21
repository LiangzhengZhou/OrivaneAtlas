import { DomainError } from "@arclattice/domain";
import type { CategoryReplayEffect } from "./category-replay-effects";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

export function buildLocalCategoryReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    !plan.command ||
    !["category.save", "category.reorder"].includes(plan.command.name) ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    !plan.mutations.length ||
    plan.mutations.length > 2000 ||
    plan.mutationIds.length !== plan.mutations.length ||
    plan.mutationIds[0] !== plan.id ||
    new Set(plan.mutationIds).size !== plan.mutationIds.length ||
    plan.mutations.some(
      (mutation, index) => mutation.id !== plan.mutationIds[index],
    )
  )
    return null;
  const first = plan.mutations[0];
  if (!first) return null;
  const commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(first.deviceId, "deviceId"),
    seen = new Set<string>();
  const effects: CategoryReplayEffect[] = plan.mutations.map((mutation) => {
    const baseVersion = mutation.baseVersion ?? 0;
    if (
      mutation.commandId !== commandId ||
      mutation.deviceId !== deviceId ||
      mutation.workspaceId !== first.workspaceId ||
      mutation.principalId !== first.principalId ||
      mutation.entityType !== "categories" ||
      seen.has(mutation.entityId) ||
      !["CREATE", "PATCH"].includes(mutation.operation) ||
      !["PENDING", "SENDING"].includes(mutation.state) ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0
    )
      throw new DomainError("VALIDATION_ERROR", { field: "categoryEffects" });
    seen.add(mutation.entityId);
    if (baseVersion === 0) requireStableUuid(mutation.entityId, "effect.id");
    return {
      collection: "categories",
      id: mutation.entityId,
      op: "UPSERT",
      baseVersion,
    };
  });
  const original = localObject(plan.command.input);
  let body: Record<string, LocalJson>;
  if (plan.command.name === "category.save") {
    if (
      Object.keys(original).some(
        (key) => !["id", "create", "input"].includes(key),
      ) ||
      typeof original.id !== "string" ||
      typeof original.create !== "boolean" ||
      original.input === undefined ||
      effects.length !== 1
    )
      throw new DomainError("VALIDATION_ERROR", { field: "categoryCommand" });
    const value = localObject(original.input),
      effect = effects[0];
    if (
      !effect ||
      effect.id !== original.id ||
      effect.baseVersion !== value.version ||
      Object.keys(value).some(
        (key) =>
          ![
            "id",
            "version",
            "name",
            "deleted",
            "icon",
            "color",
            "position",
          ].includes(key),
      ) ||
      typeof value.name !== "string" ||
      typeof value.deleted !== "boolean" ||
      (original.create
        ? value.version !== 0 || value.deleted || !!value.id
        : value.id !== original.id)
    )
      throw new DomainError("VALIDATION_ERROR", { field: "categoryCommand" });
    body = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "id"),
    );
    if (original.create)
      Object.assign(body, {
        stableId: requireStableUuid(original.id, "stableId"),
        deviceId,
      });
    else body.id = original.id;
  } else {
    if (
      Object.keys(original).some((key) => key !== "ordered") ||
      !Array.isArray(original.ordered) ||
      !original.ordered.length ||
      original.ordered.length > 2000
    )
      throw new DomainError("VALIDATION_ERROR", { field: "categoryCommand" });
    const versions = new Map<string, number>();
    for (const input of original.ordered) {
      const member = localObject(input);
      if (
        Object.keys(member).some((key) => !["id", "version"].includes(key)) ||
        typeof member.id !== "string" ||
        !member.id ||
        versions.has(member.id) ||
        typeof member.version !== "number" ||
        !Number.isSafeInteger(member.version) ||
        member.version < 1
      )
        throw new DomainError("VALIDATION_ERROR", { field: "categoryCommand" });
      versions.set(member.id, member.version);
    }
    if (
      effects.some((effect) => versions.get(effect.id) !== effect.baseVersion)
    )
      throw new DomainError("VALIDATION_ERROR", { field: "categoryEffects" });
    body = { ordered: original.ordered };
  }
  return {
    path:
      plan.command.name === "category.save"
        ? "/api/v1/categories/save"
        : "/api/v1/categories/reorder",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({ ...body, syncCommand: { commandId, deviceId, effects } }),
  };
}
