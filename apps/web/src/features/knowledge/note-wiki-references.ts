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
  const documents = library.filter(
    (entry) =>
      entry.kind === "DOCUMENT" &&
      !entry.deletedAt &&
      library.some((space) => space.id === entry.spaceId && !space.deletedAt),
  );
  return notes
    .filter(bodyLoaded)
    .filter((note) => !note.deletedAt)
    .flatMap((note) =>
      resolveWikiLinks(
        parseWikiLinks(note.bodyMd),
        documents.filter(
          (document) => document.workspaceId === note.workspaceId,
        ),
      ).map((link) => ({
        ...link,
        sourceId: note.id,
        sourceKind: note.kind,
        sourceTitle: note.title,
      })),
    );
}
