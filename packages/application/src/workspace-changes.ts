export interface WorkspaceChanges {
  collections: Record<string, { upserts: unknown[]; removed: string[] }>;
  values: Record<string, unknown>;
}
const identity = (value: unknown): string => {
  if (!value || typeof value !== "object")
    throw new Error("INVALID_SYNC_ENTITY");
  const entry = value as Record<string, unknown>;
  if (
    (entry.kind === "WORK" || entry.kind === "NOTE") &&
    "archived" in entry &&
    typeof entry.id === "string"
  )
    return entry.kind + ":" + entry.id;
  return typeof entry.id === "string" ? entry.id : JSON.stringify(entry);
};

export function workspaceChanges(
  previous: object,
  next: object,
): WorkspaceChanges {
  const old = previous as Record<string, unknown>;
  const changes: WorkspaceChanges = { collections: {}, values: {} };
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(old[key]) === JSON.stringify(value)) continue;
    if (Array.isArray(value) && Array.isArray(old[key])) {
      const before = new Map(
        (old[key] as unknown[]).map((entry) => [identity(entry), entry]),
      );
      const after = new Map(
        value.map((entry: unknown) => [identity(entry), entry]),
      );
      changes.collections[key] = {
        upserts: value.filter(
          (entry: unknown) =>
            JSON.stringify(before.get(identity(entry))) !==
            JSON.stringify(entry),
        ),
        removed: [...before.keys()].filter((id) => !after.has(id)),
      };
    } else changes.values[key] = value;
  }
  return changes;
}

export function applyWorkspaceChanges<T extends object>(
  previous: T,
  changes: WorkspaceChanges,
): T {
  if (
    !Object.keys(changes.collections).length &&
    !Object.keys(changes.values).length
  )
    return previous;
  const next: Record<string, unknown> = { ...previous, ...changes.values };
  for (const [key, change] of Object.entries(changes.collections)) {
    const before = next[key];
    if (!Array.isArray(before)) throw new Error("INVALID_SYNC_COLLECTION");
    const upserts = new Map(
      change.upserts.map((entry) => [identity(entry), entry]),
    );
    const removed = new Set(change.removed);
    next[key] = before
      .filter((entry: unknown) => !removed.has(identity(entry)))
      .map((entry: unknown) => {
        const id = identity(entry);
        const replacement = upserts.get(id);
        upserts.delete(id);
        return replacement ?? entry;
      })
      .concat([...upserts.values()]);
  }
  return next as T;
}
