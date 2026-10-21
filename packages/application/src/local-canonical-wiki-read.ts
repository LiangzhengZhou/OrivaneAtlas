import type { DocumentWikiLink } from "./library";
import { localObject } from "./local-dto";
import type { LocalEntity } from "./local-persistence";

export function requireProjectedWikiLink(
  value: unknown,
  sources: ReadonlySet<string>,
): DocumentWikiLink {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("LOCAL_DATA_CORRUPT");
  const link = value as DocumentWikiLink;
  if (
    typeof link.sourceDocumentId !== "string" ||
    !sources.has(link.sourceDocumentId) ||
    typeof link.targetText !== "string" ||
    !(
      link.targetDocumentId === null ||
      typeof link.targetDocumentId === "string"
    ) ||
    !(link.alias === null || typeof link.alias === "string") ||
    !(link.heading === null || typeof link.heading === "string")
  )
    throw new Error("LOCAL_DATA_CORRUPT");
  return link;
}

export function canonicalWikiLink(
  entity: LocalEntity,
  workspaceId: string,
  sources: ReadonlySet<string>,
): DocumentWikiLink | null {
  if (entity.workspaceId !== workspaceId || entity.collection !== "wikiLinks")
    throw new Error("LOCAL_DATA_CORRUPT");
  const value = localObject(entity.value);
  if (
    value.localTombstone === true ||
    typeof value.sourceDocumentId !== "string" ||
    !sources.has(value.sourceDocumentId)
  )
    return null;
  if (value.workspaceId !== workspaceId) throw new Error("LOCAL_DATA_CORRUPT");
  return requireProjectedWikiLink(
    {
      sourceDocumentId: value.sourceDocumentId,
      targetDocumentId: value.targetDocumentId,
      targetText: value.targetText,
      alias: value.alias,
      heading: value.heading,
    },
    sources,
  );
}
