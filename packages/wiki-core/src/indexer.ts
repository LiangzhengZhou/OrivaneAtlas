import { parseWikiLinks } from "./parser";
import { resolveWikiLinks } from "./resolver";

export function indexDocument(
  sourceDocumentId: string,
  markdown: string,
  entries: readonly {
    id: string;
    title: string;
    aliases?: readonly string[];
  }[],
) {
  return resolveWikiLinks(parseWikiLinks(markdown), entries).map((link) => ({
    sourceDocumentId,
    targetDocumentId: link.targetDocumentId,
    targetText: link.targetText,
    alias: link.alias,
    heading: link.heading,
  }));
}
