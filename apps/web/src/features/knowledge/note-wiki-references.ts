import {
  bodyLoaded,
  type WorkspaceLibraryEntry as LibraryEntry,
  type WorkspaceNote as Note,
} from "@arclattice/application";
import { parseWikiLinks, resolveWikiLinks } from "@arclattice/wiki-core";

export function noteWikiReferences(
  notes: readonly Note[],
  library: readonly LibraryEntry[],
) {
  const captures = notes.filter(bodyLoaded).filter((note) => !note.deletedAt);
  if (!captures.length) return [];
  const activeIds = new Set(
    library.filter((entry) => !entry.deletedAt).map((entry) => entry.id),
  );
  const documents = library.filter(
    (entry) =>
      entry.kind === "DOCUMENT" &&
      !entry.deletedAt &&
      activeIds.has(entry.spaceId ?? ""),
  );
  return captures.flatMap((note) =>
    resolveWikiLinks(
      parseWikiLinks(note.bodyMd),
      documents.filter((document) => document.workspaceId === note.workspaceId),
    ).map((link) => ({
      ...link,
      sourceId: note.id,
      sourceKind: note.kind,
      sourceTitle: note.title,
    })),
  );
}
