export function backlinksFor(
  links: readonly {
    sourceDocumentId: string;
    targetDocumentId: string | null;
  }[],
  targetDocumentId: string,
) {
  return links
    .filter((link) => link.targetDocumentId === targetDocumentId)
    .map((link) => link.sourceDocumentId);
}
