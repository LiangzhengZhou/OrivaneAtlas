import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

export function buildLocalOrganizationReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    plan.command?.name !== "organization.apply" ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    !plan.mutations.length ||
    plan.mutations.length > 100 ||
    plan.mutationIds.length !== plan.mutations.length ||
    plan.mutationIds[0] !== plan.id ||
    new Set(plan.mutationIds).size !== plan.mutationIds.length ||
    plan.mutations.some(
      (mutation, index) => mutation.id !== plan.mutationIds[index],
    )
  )
    return null;
  const original = localObject(plan.command.input);
  const deleted = original.action === "delete";
  if (
    Object.keys(original).some(
      (key) => !["kind", "action", "folder", "entries"].includes(key),
    ) ||
    !["WORK", "NOTE"].includes(String(original.kind)) ||
    !["archive", "unarchive", "move", "delete"].includes(
      String(original.action),
    ) ||
    !Array.isArray(original.entries) ||
    original.entries.length !== plan.mutations.length ||
    (original.action === "move"
      ? original.kind !== "NOTE" ||
        typeof original.folder !== "string" ||
        original.folder.length > 80 ||
        /[\x00-\x1f]/.test(original.folder)
      : !deleted && original.kind !== "WORK")
  )
    throw new DomainError("VALIDATION_ERROR", { field: "organizationCommand" });
  const versions = new Map<string, number>();
  for (const input of original.entries) {
    const entry = localObject(input);
    if (
      Object.keys(entry).some(
        (key) => !["id", "version", "organizationVersion"].includes(key),
      ) ||
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id.length > 240 ||
      typeof entry.version !== "number" ||
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1 ||
      typeof entry.organizationVersion !== "number" ||
      !Number.isSafeInteger(entry.organizationVersion) ||
      entry.organizationVersion < 0 ||
      versions.has(`${original.kind}:${entry.id}`)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "organizationCommand",
      });
    versions.set(
      deleted ? entry.id : `${original.kind}:${entry.id}`,
      deleted ? entry.version : entry.organizationVersion,
    );
  }
  const first = plan.mutations[0];
  if (!first) return null;
  const commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(first.deviceId, "deviceId"),
    seen = new Set<string>();
  const effects = plan.mutations.map((mutation) => {
    if (
      mutation.commandId !== commandId ||
      mutation.deviceId !== deviceId ||
      mutation.workspaceId !== first.workspaceId ||
      mutation.principalId !== first.principalId ||
      mutation.entityType !==
        (deleted
          ? original.kind === "WORK"
            ? "items"
            : "notes"
          : "organization") ||
      !["PENDING", "SENDING"].includes(mutation.state) ||
      !["CREATE", "PATCH"].includes(mutation.operation) ||
      versions.get(mutation.entityId) !== (mutation.baseVersion ?? 0) ||
      seen.has(mutation.entityId)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "organizationEffects",
      });
    seen.add(mutation.entityId);
    return {
      collection: deleted
        ? original.kind === "WORK"
          ? "items"
          : "notes"
        : "organization",
      id: mutation.entityId,
      op: "UPSERT",
      baseVersion: mutation.baseVersion ?? 0,
    };
  });
  return {
    path: "/api/v1/organize",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      ...original,
      syncCommand: { commandId, deviceId, effects },
    }),
  };
}
