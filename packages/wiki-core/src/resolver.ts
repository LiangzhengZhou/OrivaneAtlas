import { buildAliasIndex, normalizeWikiTitle } from "./aliases";
import type { WikiLink } from "./types";

export function resolveOwnedWikiLinks<
  T extends { targetText: string; targetDocumentId: string | null },
>(links: T[], entries: Parameters<typeof buildAliasIndex>[0]) {
  const index = buildAliasIndex(entries);
  for (const link of links)
    link.targetDocumentId =
      index.get(normalizeWikiTitle(link.targetText)) ?? null;
  return links;
}

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
