import type { Snapshot } from "../../bootstrap";

export function buildKnowledgeGraphIndex(
  library: Snapshot["library"],
  links: NonNullable<Snapshot["wikiLinks"]>,
) {
  const entriesById = new Map<string, Snapshot["library"][number]>();
  const spaceById = new Map<string, Snapshot["library"][number]>();
  for (const entry of library) {
    entriesById.set(entry.id, entry);
    if (entry.kind === "SPACE" && !entry.deletedAt)
      spaceById.set(entry.id, entry);
  }
  const documents: Snapshot["library"] = [];
  const documentsById = new Map<string, Snapshot["library"][number]>();
  for (const entry of library) {
    if (
      entry.kind !== "DOCUMENT" ||
      entry.deletedAt ||
      !spaceById.has(entry.spaceId ?? "")
    )
      continue;
    documents.push(entry);
    documentsById.set(entry.id, entry);
  }
  const documentsBySpaceId = new Map<string, typeof documents>();
  const outgoingByDocumentId = new Map<string, typeof links>();
  const incomingByDocumentId = new Map<string, typeof links>();
  const neighborsByDocumentId = new Map<string, Set<string>>();
  const hierarchyPathByDocumentId = new Map<string, string>();
  for (const document of documents) {
    const entries = documentsBySpaceId.get(document.spaceId ?? "") ?? [];
    entries.push(document);
    documentsBySpaceId.set(document.spaceId ?? "", entries);
    if (!document.parentDocumentId) {
      hierarchyPathByDocumentId.set(document.id, document.title);
      continue;
    }
    const path = [document.title],
      seen = new Set([document.id]);
    let parentId: string | null | undefined = document.parentDocumentId;
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
