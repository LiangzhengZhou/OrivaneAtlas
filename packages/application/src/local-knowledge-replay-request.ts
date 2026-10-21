import { DomainError } from "@arclattice/domain";
import type { KnowledgeReplayEffect } from "./knowledge-replay-effects";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

/** Original Markdown intent, never a metadata manifest or regenerated entity diff. */
export function buildLocalKnowledgeReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    !plan.command ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    ![
      "note.save",
      "note.delete",
      "note.restore",
      "library.save",
      "library.delete",
      "library.restore",
      "library.move",
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
  const first = plan.mutations[0];
  if (!first) return null;
  const commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(first.deviceId, "deviceId");
  const nextVersion = new Map<string, number>();
  const effects: KnowledgeReplayEffect[] = plan.mutations.map((mutation) => {
    const baseVersion = mutation.baseVersion ?? 0;
    if (
      mutation.commandId !== commandId ||
      mutation.deviceId !== deviceId ||
      mutation.workspaceId !== first.workspaceId ||
      mutation.principalId !== first.principalId ||
      !["PENDING", "SENDING"].includes(mutation.state) ||
      !["notes", "library"].includes(mutation.entityType) ||
      !["CREATE", "PATCH"].includes(mutation.operation) ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0
    )
      throw new DomainError("VALIDATION_ERROR", { field: "commandEffects" });
    if (baseVersion === 0) requireStableUuid(mutation.entityId, "effect.id");
    const key = JSON.stringify([mutation.entityType, mutation.entityId]);
    const expected = nextVersion.get(key);
    if (expected !== undefined && expected !== baseVersion)
      throw new DomainError("VALIDATION_ERROR", { field: "commandEffects" });
    nextVersion.set(key, baseVersion + 1);
    return {
      collection: mutation.entityType as KnowledgeReplayEffect["collection"],
      id: mutation.entityId,
      op: "UPSERT",
      baseVersion,
    };
  });
  const original = localObject(plan.command.input);
  if (plan.command.name === "library.move") {
    if (
      Object.keys(original).some(
        (key) => !["id", "version", "spaceId"].includes(key),
      ) ||
      typeof original.id !== "string" ||
      typeof original.spaceId !== "string" ||
      !original.spaceId ||
      !Number.isSafeInteger(original.version) ||
      typeof original.version !== "number" ||
      original.version < 1 ||
      effects.length !== 1 ||
      effects[0]?.collection !== "library" ||
      effects[0]?.id !== original.id ||
      effects[0]?.baseVersion !== original.version
    )
      throw new DomainError("VALIDATION_ERROR", { field: "commandInput" });
    return {
      path: "/api/v1/library/move",
      idempotencyKey: commandId,
      deviceId,
      body: localDto({
        ...original,
        syncCommand: { commandId, deviceId, effects },
      }),
    };
  }
  const restore = plan.command.name.endsWith(".restore");
  const save = plan.command.name.endsWith(".save") || restore;
  const allowed = save
    ? ["id", "version", "create", "input"]
    : ["id", "version", "deleted"];
  if (
    Object.keys(original).some((key) => !allowed.includes(key)) ||
    typeof original.id !== "string" ||
    typeof original.version !== "number" ||
    !Number.isSafeInteger(original.version) ||
    original.version < 0 ||
    (save
      ? typeof original.create !== "boolean"
      : typeof original.deleted !== "boolean")
  )
    throw new DomainError("VALIDATION_ERROR", { field: "commandInput" });
  const collection = plan.command.name.startsWith("note.")
    ? "notes"
    : "library";
  if (
    (restore &&
      (effects.length !== 2 ||
        effects.some(
          (effect, index) =>
            effect.collection !== collection ||
            effect.id !== original.id ||
            effect.baseVersion !== Number(original.version) + index,
        ))) ||
    !effects.some(
      (effect) =>
        effect.collection === collection &&
        effect.id === original.id &&
        effect.baseVersion === original.version,
    )
  )
    throw new DomainError("VALIDATION_ERROR", { field: "commandEffects" });
  let body: Record<string, LocalJson>;
  if (save) {
    if (original.input === undefined)
      throw new DomainError("VALIDATION_ERROR", { field: "commandInput" });
    const value = localObject(original.input);
    if (
      typeof value.bodyMd !== "string" ||
      (restore && (original.create !== false || original.version < 1)) ||
      (original.create && original.version !== 0)
    )
      throw new DomainError("VALIDATION_ERROR", { field: "commandInput" });
    body = {
      id: original.create ? null : original.id,
      version: original.version,
      input: value,
      ...(restore ? { restoreDeleted: true } : {}),
      ...(original.create
        ? { stableId: requireStableUuid(original.id, "stableId"), deviceId }
        : {}),
    };
  } else
    body = {
      id: original.id,
      version: original.version,
      deleted: original.deleted === true,
    };
  return {
    path:
      "/api/v1/" +
      (restore
        ? plan.command.name.replace(".restore", ".save")
        : plan.command.name
      ).replace(".", "/"),
    idempotencyKey: commandId,
    deviceId,
    body: localDto({ ...body, syncCommand: { commandId, deviceId, effects } }),
  };
}
