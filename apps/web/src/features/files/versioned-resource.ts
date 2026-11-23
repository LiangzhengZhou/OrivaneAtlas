export interface VersionedResource {
  kind: "NOTE" | "DOCUMENT" | "FILE";
  id: string;
  version: number;
  parentDocumentId?: string | null | undefined;
}

/** Keep the hierarchy valid between individual version-checked commands. */
export function orderResourceTrashEntries(
  items: readonly VersionedResource[],
  deleted: boolean,
) {
  const docs = new Map(
    items.flatMap((item) =>
      item.kind === "DOCUMENT" ? [[item.id, item] as const] : [],
    ),
  );
  const outgoing = new Map<VersionedResource, VersionedResource[]>();
  const pending = new Map<VersionedResource, number>();
  for (const item of items) {
    const parent = item.parentDocumentId && docs.get(item.parentDocumentId);
    if (!parent) continue;
    const [first, after] = deleted ? [item, parent] : [parent, item];
    const next = outgoing.get(first) ?? [];
    next.push(after);
    outgoing.set(first, next);
    pending.set(after, (pending.get(after) ?? 0) + 1);
  }
  const ordered = items.filter((item) => !pending.has(item));
  for (let index = 0; index < ordered.length; index++) {
    for (const next of outgoing.get(ordered[index]!) ?? []) {
      const remaining = pending.get(next)! - 1;
      if (remaining === 0) ordered.push(next);
      pending.set(next, remaining);
    }
  }
  if (ordered.length !== items.length)
    throw new Error("RESOURCE_HIERARCHY_CYCLE");
  return ordered;
}
