import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";
import { parseProjectPlan } from "./workflows";

export function buildLocalPlanReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    !plan.command ||
    !["plan.preview", "plan.publish"].includes(plan.command.name) ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    !plan.mutations.length ||
    plan.mutations.length > 2000 ||
    plan.mutationIds.length !== plan.mutations.length ||
    plan.mutationIds[0] !== plan.id ||
    new Set(plan.mutationIds).size !== plan.mutationIds.length ||
    plan.mutations.some((m, i) => m.id !== plan.mutationIds[i])
  )
    return null;
  const first = plan.mutations[0]!,
    commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(first.deviceId, "deviceId"),
    original = localObject(plan.command.input),
    invalid = (): never => {
      throw new DomainError("VALIDATION_ERROR", { field: "planCommand" });
    },
    versions = new Map<string, number>();
  const effects = plan.mutations.map((m) => {
    const baseVersion = m.baseVersion ?? 0,
      identity = JSON.stringify([m.entityType, m.entityId]),
      previous = versions.get(identity);
    if (
      m.commandId !== commandId ||
      m.deviceId !== deviceId ||
      m.workspaceId !== first.workspaceId ||
      m.principalId !== first.principalId ||
      ![
        "items",
        "edges",
        "categories",
        "workflows",
        "library",
        "projectMaterials",
      ].includes(m.entityType) ||
      !["PENDING", "SENDING"].includes(m.state) ||
      !["CREATE", "PATCH"].includes(m.operation) ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0 ||
      (previous !== undefined && previous !== baseVersion) ||
      (m.entityType === "edges" &&
        (baseVersion !== 0 || previous !== undefined))
    )
      invalid();
    if (!baseVersion) requireStableUuid(m.entityId, "effect.id");
    versions.set(identity, baseVersion + 1);
    return {
      collection: m.entityType,
      id: m.entityId,
      op: "UPSERT",
      baseVersion,
    };
  });
  if (
    typeof original.id !== "string" ||
    !original.id ||
    original.id.length > 240
  )
    invalid();
  if (plan.command.name === "plan.preview") {
    if (
      effects.length !== 1 ||
      effects[0]?.collection !== "workflows" ||
      effects[0]?.id !== original.id ||
      effects[0]?.baseVersion !== 0 ||
      Object.keys(original).some(
        (k) =>
          ![
            "id",
            "projectId",
            "manifest",
            "baseRevision",
            "documentRevision",
          ].includes(k),
      ) ||
      (original.projectId !== null &&
        (typeof original.projectId !== "string" || !original.projectId)) ||
      typeof original.baseRevision !== "string" ||
      !original.baseRevision ||
      typeof original.documentRevision !== "string"
    )
      invalid();
    parseProjectPlan(original.manifest);
    return {
      path: "/api/v1/plans/preview",
      idempotencyKey: commandId,
      deviceId,
      body: localDto({
        projectId: original.projectId,
        manifest: original.manifest,
        stableId: requireStableUuid(original.id, "stableId"),
        deviceId,
        baseRevision: original.baseRevision,
        documentRevision: original.documentRevision,
        syncCommand: { commandId, deviceId, effects },
      }),
    };
  }
  const primary = effects.filter(
    (e) => e.collection === "workflows" && e.id === original.id,
  );
  if (
    Object.keys(original).some((k) => !["id", "version"].includes(k)) ||
    typeof original.version !== "number" ||
    !Number.isSafeInteger(original.version) ||
    original.version < 1 ||
    primary.length !== 1 ||
    primary[0]?.baseVersion !== original.version
  )
    invalid();
  return {
    path: "/api/v1/plans/publish",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      id: original.id,
      version: original.version,
      syncCommand: { commandId, deviceId, effects },
    }),
  };
}
