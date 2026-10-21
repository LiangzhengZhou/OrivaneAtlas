import { DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

export function buildLocalNoteKnowledgeReplayRequest(
  input: LocalCommandPlan,
): LocalWorkReplayRequest | null {
  const plan = structuredClone(input);
  if (
    !plan.command ||
    !["note.space.link", "note.document.promote"].includes(plan.command.name) ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    !plan.mutations.length ||
    plan.mutations.length > 3 ||
    plan.mutationIds.length !== plan.mutations.length ||
    plan.mutationIds[0] !== plan.id ||
    new Set(plan.mutationIds).size !== plan.mutationIds.length ||
    plan.mutations.some((m, i) => m.id !== plan.mutationIds[i])
  )
    return null;
  const first = plan.mutations[0]!,
    commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(first.deviceId, "deviceId"),
    original = localObject(plan.command.input);
  const invalid = (): never => {
    throw new DomainError("VALIDATION_ERROR", {
      field: "noteKnowledgeCommand",
    });
  };
  const seen = new Set<string>();
  const effects = plan.mutations.map((m) => {
    const baseVersion = m.baseVersion ?? 0,
      identity = `${m.entityType}:${m.entityId}`;
    if (
      m.commandId !== commandId ||
      m.deviceId !== deviceId ||
      m.workspaceId !== first.workspaceId ||
      m.principalId !== first.principalId ||
      !["notes", "library", "links"].includes(m.entityType) ||
      !["PENDING", "SENDING"].includes(m.state) ||
      !["CREATE", "PATCH"].includes(m.operation) ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0 ||
      seen.has(identity)
    )
      invalid();
    if (!baseVersion) requireStableUuid(m.entityId, "effect.id");
    seen.add(identity);
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
    typeof original.version !== "number" ||
    !Number.isSafeInteger(original.version) ||
    original.version < 1
  )
    invalid();
  const links = effects.filter((e) => e.collection === "links"),
    link = links[0];
  if (
    links.length !== 1 ||
    !link ||
    link.baseVersion !== 0 ||
    link.id !== original.linkId
  )
    invalid();
  const stableLinkId = requireStableUuid(original.linkId, "stableLinkId");
  if (plan.command.name === "note.space.link") {
    if (
      effects.length !== 1 ||
      typeof original.spaceId !== "string" ||
      !original.spaceId ||
      Object.keys(original).some(
        (k) => !["id", "version", "spaceId", "linkId"].includes(k),
      )
    )
      invalid();
    return {
      path: "/api/v1/note/link-space",
      idempotencyKey: commandId,
      deviceId,
      body: localDto({
        id: original.id,
        version: original.version,
        spaceId: original.spaceId,
        stableLinkId,
        deviceId,
        syncCommand: { commandId, deviceId, effects },
      }),
    };
  }
  const promotion = localObject(original.input ?? null),
    libraries = effects.filter((e) => e.collection === "library"),
    notes = effects.filter((e) => e.collection === "notes");
  if (
    Object.keys(original).some(
      (k) => !["id", "version", "input", "documentId", "linkId"].includes(k),
    ) ||
    Object.keys(promotion).some(
      (k) => !["spaceId", "parentDocumentId", "archiveSourceNote"].includes(k),
    ) ||
    typeof promotion.spaceId !== "string" ||
    !promotion.spaceId ||
    (promotion.parentDocumentId !== null &&
      typeof promotion.parentDocumentId !== "string") ||
    typeof promotion.archiveSourceNote !== "boolean" ||
    libraries.length !== 1 ||
    libraries[0]?.id !== original.documentId ||
    libraries[0]?.baseVersion !== 0 ||
    notes.length !== (promotion.archiveSourceNote ? 1 : 0) ||
    notes.some(
      (e) => e.id !== original.id || e.baseVersion !== original.version,
    )
  )
    invalid();
  return {
    path: "/api/v1/note/promote",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      id: original.id,
      version: original.version,
      ...promotion,
      stableDocumentId: requireStableUuid(
        original.documentId,
        "stableDocumentId",
      ),
      stableLinkId,
      deviceId,
      syncCommand: { commandId, deviceId, effects },
    }),
  };
}
