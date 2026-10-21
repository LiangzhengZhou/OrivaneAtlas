import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

export function buildLocalProjectKnowledgeReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    !plan.command ||
    ![
      "project.space.create",
      "project.space.link",
      "project.document.create",
      "project.material.delete",
    ].includes(plan.command.name) ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    !plan.mutations.length ||
    plan.mutations.length > 2 ||
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
  const effects = plan.mutations.map((mutation) => {
    const baseVersion = mutation.baseVersion ?? 0,
      identity = `${mutation.entityType}:${mutation.entityId}`;
    if (
      mutation.commandId !== commandId ||
      mutation.deviceId !== deviceId ||
      mutation.workspaceId !== first.workspaceId ||
      mutation.principalId !== first.principalId ||
      !["projectMaterials", "library"].includes(mutation.entityType) ||
      !["PENDING", "SENDING"].includes(mutation.state) ||
      !["CREATE", "PATCH"].includes(mutation.operation) ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0 ||
      seen.has(identity)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "projectKnowledgeEffects",
      });
    if (!baseVersion) requireStableUuid(mutation.entityId, "effect.id");
    seen.add(identity);
    return {
      collection: mutation.entityType,
      id: mutation.entityId,
      op: "UPSERT",
      baseVersion,
    };
  });
  const original = localObject(plan.command.input),
    materials = effects.filter(
      (effect) => effect.collection === "projectMaterials",
    ),
    libraries = effects.filter((effect) => effect.collection === "library"),
    material = materials[0];
  if (materials.length !== 1 || !material)
    throw new DomainError("VALIDATION_ERROR", {
      field: "projectKnowledgeEffects",
    });
  let body: Record<string, LocalJson>, path: string;
  if (plan.command.name === "project.material.delete") {
    if (
      Object.keys(original).some(
        (key) => !["id", "version", "deleted"].includes(key),
      ) ||
      original.id !== material.id ||
      original.version !== material.baseVersion ||
      material.baseVersion < 1 ||
      typeof original.deleted !== "boolean" ||
      libraries.some((effect) => effect.baseVersion < 1)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "projectKnowledgeCommand",
      });
    body = original;
    path = "/api/v1/projects/delete";
  } else {
    const linked = plan.command.name === "project.space.link";
    if (
      Object.keys(original).some(
        (key) => !["materialId", "targetId", "input"].includes(key),
      ) ||
      original.materialId !== material.id ||
      material.baseVersion !== 0 ||
      original.input === undefined ||
      (linked
        ? libraries.length !== 0 || original.targetId !== undefined
        : libraries.length !== 1 ||
          libraries[0]?.id !== original.targetId ||
          libraries[0]?.baseVersion !== 0)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "projectKnowledgeCommand",
      });
    const value = localObject(original.input),
      document = plan.command.name === "project.document.create";
    if (
      Object.keys(value).some(
        (key) =>
          !(
            document
              ? [
                  "projectId",
                  "spaceId",
                  "title",
                  "bodyMd",
                  "provenance",
                  "aiPolicy",
                ]
              : linked
                ? ["projectId", "spaceId", "role", "inheritToChildren"]
                : ["projectId", "title", "role", "inheritToChildren"]
          ).includes(key),
      ) ||
      typeof value.projectId !== "string" ||
      !value.projectId ||
      ((document || linked) &&
        (typeof value.spaceId !== "string" || !value.spaceId)) ||
      (!linked && typeof value.title !== "string") ||
      (document && typeof value.bodyMd !== "string")
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "projectKnowledgeCommand",
      });
    body = {
      ...value,
      stableMaterialId: material.id,
      deviceId,
      ...(linked ? {} : { stableTargetId: original.targetId! }),
    };
    path = linked
      ? "/api/v1/projects/space/link"
      : document
        ? "/api/v1/projects/document/create"
        : "/api/v1/projects/space/create";
  }
  return {
    path,
    idempotencyKey: commandId,
    deviceId,
    body: localDto({ ...body, syncCommand: { commandId, deviceId, effects } }),
  };
}
