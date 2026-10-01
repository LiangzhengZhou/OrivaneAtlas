import { buildAliasIndex, normalizeWikiTitle } from "./aliases";
import type { WikiLink } from "./types";

export function resolveWikiLinks(
  links: readonly WikiLink[],
  entries: readonly {
    id: string;
    title: string;
    aliases?: readonly string[];
  }[],
) {
  const index = buildAliasIndex(entries);
  return links.map((link) => ({
    ...link,
    targetDocumentId: index.get(normalizeWikiTitle(link.targetText)) ?? null,
  }));
}
