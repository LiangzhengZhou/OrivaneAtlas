import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

export type FolderLinkReplayCollection =
  | "folderLinks"
  | "spaceFolderLinks"
  | "projectFolderLinks";
export interface FolderLinkReplayEffect {
  readonly collection: FolderLinkReplayCollection;
  readonly id: string;
  readonly op: "UPSERT" | "DELETE";
  readonly baseVersion: number;
}

const commandCollections = {
  "folderLink.create": "folderLinks",
  "folderLink.delete": "folderLinks",
  "spaceFolderLink.create": "spaceFolderLinks",
  "spaceFolderLink.delete": "spaceFolderLinks",
  "projectFolderLink.create": "projectFolderLinks",
  "projectFolderLink.delete": "projectFolderLinks",
} as const;
type FolderLinkCommand = keyof typeof commandCollections;

/** Original FolderLink intent; server-side receipts preserve the same bytes. */
export function buildLocalFolderLinkReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  const name = plan.command?.name as FolderLinkCommand | undefined;
  if (
    !name ||
    !(name in commandCollections) ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    plan.mutations.length !== 1 ||
    plan.mutationIds.length !== 1 ||
    plan.mutationIds[0] !== plan.id
  )
    return null;
  const mutation = plan.mutations[0]!;
  if (
    mutation.commandId !== plan.id ||
    !["PENDING", "SENDING"].includes(mutation.state) ||
    mutation.entityType !== commandCollections[name] ||
    !["CREATE", "PATCH"].includes(mutation.operation)
  )
    throw new DomainError("VALIDATION_ERROR", { field: "commandEffects" });
  const commandId = requireStableUuid(plan.id, "commandId");
  const deviceId = requireStableUuid(mutation.deviceId, "deviceId");
  const original = localObject(plan.command!.input);
  const create = name.endsWith(".create");
  const required = (field: string): LocalJson => {
    if (original[field] === undefined)
      throw new DomainError("VALIDATION_ERROR", { field });
    return original[field];
  };
  const allow = (keys: readonly string[]) => {
    if (Object.keys(original).some((key) => !keys.includes(key)))
      throw new DomainError("VALIDATION_ERROR", { field: "commandInput" });
  };
  const id = requireStableUuid(original.id, "id");
  const version = create ? 0 : Number(required("version"));
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    (create && version !== 0) ||
    (!create && version < 1) ||
    mutation.entityId !== id ||
    mutation.baseVersion !== version
  )
    throw new DomainError("VALIDATION_ERROR", { field: "commandEffects" });
  const effect: FolderLinkReplayEffect = {
    collection: commandCollections[name],
    id,
    op: "UPSERT",
    baseVersion: version,
  };
  let path: string;
  let body: Record<string, LocalJson>;
  if (name === "folderLink.create") {
    allow(["id", "folderId", "targetKind", "targetId"]);
    path = "/api/v1/folders/link";
    body = {
      folderId: required("folderId"),
      targetKind: required("targetKind"),
      targetId: required("targetId"),
      stableId: id,
    };
  } else if (name === "folderLink.delete") {
    allow(["id", "version"]);
    path = "/api/v1/folders/unlink";
    body = { id, version: required("version") };
  } else if (name === "spaceFolderLink.create") {
    allow(["id", "spaceId", "folderId"]);
    path = "/api/v1/space-folders/link";
    body = {
      spaceId: required("spaceId"),
      folderId: required("folderId"),
      stableId: id,
    };
  } else if (name === "spaceFolderLink.delete") {
    allow(["id", "version"]);
    path = "/api/v1/space-folders/unlink";
    body = { id, version: required("version") };
  } else if (name === "projectFolderLink.create") {
    allow(["id", "projectId", "folderId"]);
    path = "/api/v1/project-folders/link";
    body = {
      projectId: required("projectId"),
      folderId: required("folderId"),
      stableId: id,
    };
  } else {
    allow(["id", "version"]);
    path = "/api/v1/project-folders/unlink";
    body = { id, version: required("version") };
  }
  return {
    path,
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      ...body,
      syncCommand: { commandId, deviceId, effects: [effect] },
    }),
  };
}
