import {
  type Note,
  noteWikiReferences,
  type WorkspaceLibraryEntry,
} from "@arclattice/application";
import { parseWikiLinks, resolveWikiLinks } from "@arclattice/wiki-core";

export function noteBacklinks(
  notes: readonly Note[],
  library: readonly WorkspaceLibraryEntry[],
) {
  return noteWikiReferences(notes, library, (markdown, documents) =>
    resolveWikiLinks(parseWikiLinks(markdown), documents),
  );
}
