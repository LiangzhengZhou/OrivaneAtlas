import { DomainError } from "@arclattice/domain";
import { type ContentPolicy, contentPolicy } from "./content-policy";
import type { LibraryEntry } from "./library";
import { localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import type { Note } from "./notebook";
import type { BodyManifest } from "./workspace-bootstrap";

function invalid(): never {
  throw new DomainError("VALIDATION_ERROR", { field: "canonicalKnowledge" });
}
/** Receipts/hydration require the full authoritative body, never an unloaded manifest. */
export function validateLocalCanonicalKnowledgeValue(
  collection: "notes" | "library",
  id: string,
  remoteWorkspaceId: string,
  version: number,
  value: LocalJson,
): Note | LibraryEntry {
  const entity = validateMetadata(
    collection,
    id,
    remoteWorkspaceId,
    version,
    value,
  );
  if (
    typeof entity.bodyMd !== "string" ||
    entity.bodyMd.length > 200000 ||
    Object.hasOwn(entity, "bodyState")
  )
    invalid();
  return structuredClone(entity) as unknown as Note | LibraryEntry;
}

export function validateLocalCanonicalKnowledgeManifest(
  collection: "notes" | "library",
  id: string,
  remoteWorkspaceId: string,
  version: number,
  value: LocalJson,
): BodyManifest<Note | LibraryEntry> {
  const entity = validateMetadata(
    collection,
    id,
    remoteWorkspaceId,
    version,
    value,
  );
  if (
    entity.bodyState !== "UNLOADED" ||
    Object.hasOwn(entity, "bodyMd") ||
    typeof entity.bodyCharacterCount !== "number" ||
    !Number.isSafeInteger(entity.bodyCharacterCount) ||
    entity.bodyCharacterCount < 0 ||
    entity.bodyCharacterCount > 200000
  )
    invalid();
  return structuredClone(entity) as unknown as BodyManifest<
    Note | LibraryEntry
  >;
}

function validateMetadata(
  collection: "notes" | "library",
  id: string,
  remoteWorkspaceId: string,
  version: number,
  value: LocalJson,
) {
  const entity = localObject(value);
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    entity.id !== id ||
    entity.workspaceId !== remoteWorkspaceId ||
    entity.version !== version ||
    typeof entity.title !== "string" ||
    (!(collection === "library" && entity.kind === "DOCUMENT") &&
      !entity.title.trim()) ||
    typeof entity.createdBy !== "string" ||
    !entity.createdBy ||
    typeof entity.updatedBy !== "string" ||
    !entity.updatedBy ||
    typeof entity.createdAt !== "string" ||
    !Number.isFinite(Date.parse(entity.createdAt)) ||
    typeof entity.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(entity.updatedAt)) ||
    (entity.deletedAt !== null &&
      (typeof entity.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(entity.deletedAt)))) ||
    !["HUMAN", "EXTERNAL_AI"].includes(String(entity.provenance))
  )
    invalid();
  if (entity.aiPolicy !== undefined)
    contentPolicy(localObject(entity.aiPolicy) as unknown as ContentPolicy);
  if (collection === "notes") {
    if (
      !["NOTE", "JOURNAL"].includes(String(entity.kind)) ||
      entity.classification !== "PRIVATE" ||
      entity.boundary !== "REMOTE" ||
      !["ALLOW", "ASK", "DENY"].includes(String(entity.aiAccess))
    )
      invalid();
    if (
      entity.kind === "NOTE"
        ? entity.day !== null
        : typeof entity.day !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(entity.day) ||
          !Number.isFinite(Date.parse(entity.day)) ||
          new Date(entity.day).toISOString().slice(0, 10) !== entity.day
    )
      invalid();
  } else {
    if (
      !["SPACE", "DOCUMENT"].includes(String(entity.kind)) ||
      (entity.kind === "SPACE"
        ? entity.spaceId !== null
        : typeof entity.spaceId !== "string" || !entity.spaceId) ||
      (entity.parentDocumentId !== undefined &&
        entity.parentDocumentId !== null &&
        typeof entity.parentDocumentId !== "string") ||
      (entity.aliases !== undefined &&
        (!Array.isArray(entity.aliases) ||
          entity.aliases.some((alias) => typeof alias !== "string")))
    )
      invalid();
  }
  return entity;
}
