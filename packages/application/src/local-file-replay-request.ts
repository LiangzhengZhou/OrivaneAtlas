import { DomainError, requireFileName } from "@arclattice/domain";
import { type ContentPolicy, contentPolicy } from "./content-policy";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

/** Serializes metadata intent only. Binary transfer must finish before upload replay. */
export function buildLocalFileReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    !plan.command ||
    !["file.upload", "file.rename", "file.delete", "file.policy"].includes(
      plan.command.name,
    ) ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    plan.mutations.length !== 1 ||
    plan.mutationIds.length !== 1 ||
    plan.mutationIds[0] !== plan.id ||
    plan.mutations[0]?.id !== plan.id
  )
    return null;
  const mutation = plan.mutations[0]!,
    commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(mutation.deviceId, "deviceId"),
    original = localObject(plan.command.input),
    baseVersion = mutation.baseVersion ?? 0,
    create = plan.command.name === "file.upload",
    invalid = (): never => {
      throw new DomainError("VALIDATION_ERROR", { field: "fileCommand" });
    };
  if (
    mutation.commandId !== commandId ||
    mutation.entityType !== "files" ||
    !["PENDING", "SENDING"].includes(mutation.state) ||
    mutation.operation !== (create ? "CREATE" : "PATCH") ||
    !Number.isSafeInteger(baseVersion) ||
    baseVersion < 0 ||
    original.id !== mutation.entityId ||
    typeof original.id !== "string" ||
    !original.id ||
    original.id.length > 240 ||
    (create
      ? baseVersion !== 0
      : baseVersion < 1 || original.version !== baseVersion)
  )
    invalid();
  let body: Record<string, LocalJson>;
  if (create) {
    if (
      Object.keys(original).some(
        (k) => !["id", "input", "contentHash", "size"].includes(k),
      ) ||
      typeof original.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(original.contentHash) ||
      typeof original.size !== "number" ||
      !Number.isSafeInteger(original.size) ||
      original.size < 0 ||
      original.size > 100 * 1024 * 1024
    )
      invalid();
    const upload = localObject(original.input ?? null);
    if (
      Object.keys(upload).some(
        (k) =>
          !["name", "mime", "spaceId", "parentDocumentId", "aiPolicy"].includes(
            k,
          ),
      ) ||
      typeof upload.name !== "string" ||
      typeof upload.mime !== "string" ||
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(upload.mime) ||
      upload.mime.length > 127 ||
      (upload.spaceId !== null &&
        (typeof upload.spaceId !== "string" ||
          !upload.spaceId ||
          upload.spaceId.length > 240)) ||
      (upload.parentDocumentId !== undefined &&
        upload.parentDocumentId !== null &&
        (typeof upload.parentDocumentId !== "string" ||
          !upload.parentDocumentId ||
          upload.parentDocumentId.length > 240))
    )
      invalid();
    requireFileName(upload.name as string);
    if (upload.aiPolicy !== undefined)
      contentPolicy(upload.aiPolicy as unknown as ContentPolicy);
    body = {
      ...upload,
      contentHash: original.contentHash!,
      size: original.size!,
      stableId: requireStableUuid(mutation.entityId, "stableId"),
      deviceId,
    };
  } else {
    const rename = plan.command.name === "file.rename",
      policy = plan.command.name === "file.policy";
    if (
      Object.keys(original).some(
        (k) =>
          !(
            rename
              ? ["id", "version", "name"]
              : policy
                ? ["id", "version", "aiPolicy"]
                : ["id", "version", "deleted"]
          ).includes(k),
      ) ||
      (rename
        ? typeof original.name !== "string"
        : policy
          ? !original.aiPolicy ||
            typeof original.aiPolicy !== "object" ||
            Array.isArray(original.aiPolicy)
          : typeof original.deleted !== "boolean")
    )
      invalid();
    if (rename) requireFileName(original.name as string);
    if (policy) contentPolicy(original.aiPolicy as unknown as ContentPolicy);
    body = original;
  }
  return {
    path: create
      ? "/api/v1/files/register"
      : plan.command.name === "file.rename"
        ? "/api/v1/files/rename"
        : plan.command.name === "file.policy"
          ? "/api/v1/files/policy"
          : "/api/v1/files/delete",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      ...body,
      syncCommand: {
        commandId,
        deviceId,
        effects: [
          {
            collection: "files",
            id: mutation.entityId,
            op: "UPSERT",
            baseVersion,
          },
        ],
      },
    }),
  };
}
