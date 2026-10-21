import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

export function buildLocalLinkedKnowledgeReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    !plan.command ||
    !["link.create", "link.delete"].includes(plan.command.name) ||
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
    value = localObject(plan.command.input),
    baseVersion = mutation.baseVersion ?? 0,
    create = plan.command.name === "link.create";
  if (
    mutation.commandId !== commandId ||
    mutation.entityType !== "links" ||
    !["PENDING", "SENDING"].includes(mutation.state) ||
    !["CREATE", "PATCH"].includes(mutation.operation) ||
    !Number.isSafeInteger(baseVersion) ||
    baseVersion < 0 ||
    value.id !== mutation.entityId ||
    Object.keys(value).some(
      (key) =>
        !(
          create ? ["id", "from", "to", "relation"] : ["id", "version"]
        ).includes(key),
    ) ||
    (create
      ? baseVersion !== 0
      : baseVersion < 1 || value.version !== baseVersion)
  )
    throw new DomainError("VALIDATION_ERROR", { field: "linkCommand" });
  let body: Record<string, LocalJson>;
  if (create) {
    const from = localObject(value.from ?? null),
      to = localObject(value.to ?? null);
    if (
      ![from, to].every(
        (ref) =>
          Object.keys(ref).every((key) => ["kind", "id"].includes(key)) &&
          ["NOTE", "WORK", "SPACE", "DOCUMENT", "FILE"].some(
            (kind) => kind === ref.kind,
          ) &&
          typeof ref.id === "string" &&
          !!ref.id &&
          ref.id.length <= 240,
      ) ||
      !["REFERENCES", "RELATED"].some((relation) => relation === value.relation)
    )
      throw new DomainError("VALIDATION_ERROR", { field: "linkCommand" });
    body = {
      from,
      to,
      relation: value.relation!,
      stableId: requireStableUuid(mutation.entityId, "stableId"),
      deviceId,
    };
  } else body = value;
  return {
    path: create ? "/api/v1/link/create" : "/api/v1/link/delete",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      ...body,
      syncCommand: {
        commandId,
        deviceId,
        effects: [
          {
            collection: "links",
            id: mutation.entityId,
            op: "UPSERT",
            baseVersion,
          },
        ],
      },
    }),
  };
}
