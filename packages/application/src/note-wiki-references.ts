import type { Note } from "./notebook";
import type { WorkspaceLibraryEntry } from "./workspace-bootstrap";

export interface NoteWikiResolver {
  (
    markdown: string,
    documents: readonly WorkspaceLibraryEntry[],
  ): {
    targetDocumentId: string | null;
    targetText: string;
    alias: string | null;
    heading: string | null;
    start: number;
    end: number;
    embed: boolean;
  }[];
}
export function noteWikiReferences(
  notes: readonly Note[],
  library: readonly WorkspaceLibraryEntry[],
  resolve: NoteWikiResolver,
) {
  const spaces = new Set(
    library
      .filter((entry) => entry.kind === "SPACE" && !entry.deletedAt)
      .map((entry) => entry.id),
  );
  const documents = library.filter(
    (entry) =>
      entry.kind === "DOCUMENT" &&
      !entry.deletedAt &&
      spaces.has(entry.spaceId ?? ""),
  );
  return notes
    .filter((note) => !note.deletedAt)
    .flatMap((note) =>
      resolve(
        note.bodyMd,
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
