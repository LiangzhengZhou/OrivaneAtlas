import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

const organizationActionKeys = [
  "kind",
  "action",
  "folder",
  "folderId",
  "name",
  "parentId",
  "id",
  "icon",
  "entries",
] as const;
function validFolderName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= 80 &&
    !/[\x00-\x1f]/.test(value)
  );
}
function validParent(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" &&
      value.length <= 240 &&
      !/[\x00-\x1f]/.test(value))
  );
}
function validIcon(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value === "" || value.trim() !== "") &&
    [...value].length <= 16 &&
    !/[\x00-\x1f]/.test(value)
  );
}
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
  const kind = String(original.kind);
  const action = String(original.action);
  // FOLDER deletion is a soft archive (organization UPSERT), not an entity delete.
  const deleted = action === "delete" && kind !== "FOLDER";
  // Folder creation has no entries; every other action targets existing rows.
  const createsFolder = kind === "FOLDER" && action === "create";
  const entries = createsFolder ? [] : original.entries;
  if (
    Object.keys(original).some(
      (key) =>
        !organizationActionKeys.includes(
          key as (typeof organizationActionKeys)[number],
        ),
    ) ||
    !["WORK", "NOTE", "FOLDER"].includes(kind) ||
    ![
      "archive",
      "unarchive",
      "move",
      "delete",
      "create",
      "rename",
      "icon",
    ].includes(action) ||
    !Array.isArray(entries) ||
    (!createsFolder && entries.length !== plan.mutations.length) ||
    (createsFolder &&
      (plan.mutations.length !== 1 ||
        !requireStableUuid(original.id, "folderId") ||
        !validFolderName(original.name) ||
        !validParent(original.parentId))) ||
    (!createsFolder && original.id !== undefined) ||
    (action === "create" && kind !== "FOLDER") ||
    (action === "rename" &&
      (kind !== "FOLDER" || !validFolderName(original.name))) ||
    (action === "icon" && (kind === "WORK" || !validIcon(original.icon))) ||
    (action === "delete" && original.name !== undefined) ||
    (action === "move" &&
      ((kind === "NOTE" &&
        typeof original.folderId !== "string" &&
        (typeof original.folder !== "string" ||
          original.folder.length > 80 ||
          /[\x00-\x1f]/.test(original.folder))) ||
        (kind === "FOLDER" && !validParent(original.parentId)) ||
        kind === "WORK")) ||
    (action === "archive" && kind !== "WORK") ||
    (action === "unarchive" && kind !== "WORK" && kind !== "FOLDER")
  )
    throw new DomainError("VALIDATION_ERROR", { field: "organizationCommand" });
  const versions = new Map<string, number>();
  if (createsFolder) versions.set(`FOLDER:${original.id}`, 0);
  for (const input of entries) {
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
      versions.has(deleted ? entry.id : `${kind}:${entry.id}`)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "organizationCommand",
      });
    versions.set(
      deleted ? entry.id : `${kind}:${entry.id}`,
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
        (deleted ? (kind === "WORK" ? "items" : "notes") : "organization") ||
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
        ? kind === "WORK"
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
