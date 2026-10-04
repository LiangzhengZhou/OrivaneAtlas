import type { Snapshot } from "../../bootstrap";

export function buildKnowledgeGraphIndex(
  library: Snapshot["library"],
  links: NonNullable<Snapshot["wikiLinks"]>,
) {
  const entriesById = new Map(library.map((entry) => [entry.id, entry]));
  const spaceById = new Map(
    library
      .filter((entry) => entry.kind === "SPACE" && !entry.deletedAt)
      .map((entry) => [entry.id, entry]),
  );
  const documents = library.filter(
    (entry) =>
      entry.kind === "DOCUMENT" &&
      !entry.deletedAt &&
      spaceById.has(entry.spaceId ?? ""),
  );
  const documentsById = new Map(documents.map((entry) => [entry.id, entry]));
  const documentsBySpaceId = new Map<string, typeof documents>();
  const outgoingByDocumentId = new Map<string, typeof links>();
  const incomingByDocumentId = new Map<string, typeof links>();
  const neighborsByDocumentId = new Map<string, Set<string>>();
  const hierarchyPathByDocumentId = new Map<string, string>();
  for (const document of documents) {
    const entries = documentsBySpaceId.get(document.spaceId ?? "") ?? [];
    entries.push(document);
    documentsBySpaceId.set(document.spaceId ?? "", entries);
    const path = [document.title],
      seen = new Set([document.id]);
    let parentId = document.parentDocumentId;
    while (parentId && !seen.has(parentId)) {
      const parent = documentsById.get(parentId);
      if (!parent || parent.spaceId !== document.spaceId) break;
      seen.add(parentId);
      path.unshift(parent.title);
      parentId = parent.parentDocumentId;
    }
    hierarchyPathByDocumentId.set(document.id, path.join(" / "));
  }
  for (const link of links) {
    const outgoing = outgoingByDocumentId.get(link.sourceDocumentId) ?? [];
    outgoing.push(link);
    outgoingByDocumentId.set(link.sourceDocumentId, outgoing);
    if (!link.targetDocumentId) continue;
    const incoming = incomingByDocumentId.get(link.targetDocumentId) ?? [];
    incoming.push(link);
    incomingByDocumentId.set(link.targetDocumentId, incoming);
    for (const [source, target] of [
      [link.sourceDocumentId, link.targetDocumentId],
      [link.targetDocumentId, link.sourceDocumentId],
    ] as const) {
      const neighbors = neighborsByDocumentId.get(source) ?? new Set<string>();
      neighbors.add(target);
      neighborsByDocumentId.set(source, neighbors);
    }
  }
  return {
    entriesById,
    documents,
    documentsById,
    documentsBySpaceId,
    spaceById,
    outgoingByDocumentId,
    incomingByDocumentId,
    neighborsByDocumentId,
    hierarchyPathByDocumentId,
  };
}

export function knowledgeNeighborhood(
  index: ReturnType<typeof buildKnowledgeGraphIndex>,
  focus: string,
  hops: number,
) {
  const visited = new Set(focus ? [focus] : []);
  let frontier = [...visited];
  for (let hop = 0; hop < hops; hop++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const neighbor of index.neighborsByDocumentId.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    frontier = next;
  }
  return visited;
}
