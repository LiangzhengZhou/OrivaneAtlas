export function normalizeWikiTitle(title: string) {
  return title
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function buildAliasIndex(
  entries: readonly {
    id: string;
    title: string;
    aliases?: readonly string[];
  }[],
) {
  const index = new Map<string, string>();
  for (const entry of entries) {
    index.set(normalizeWikiTitle(entry.title), entry.id);
    for (const alias of entry.aliases ?? [])
      index.set(normalizeWikiTitle(alias), entry.id);
  }
  return index;
}
