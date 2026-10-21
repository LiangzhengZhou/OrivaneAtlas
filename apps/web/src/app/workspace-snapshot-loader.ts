/** One scope owns this loader; published objects remain with the UI, not a cache.
 * Only a durably unchanged business revision may skip duplicate reconstruction.
 */
export function workspaceSnapshotLoader<T>(
  readRevision: () => Promise<number | null>,
  load: () => Promise<T>,
  validatedRevision?: (value: T) => number | null | undefined,
) {
  let applied: number | null | undefined;
  return async (publish: (value: T) => boolean): Promise<void> => {
    try {
      const before = await readRevision();
      if (applied !== undefined && before === applied) return;
      const value = await load();
      const after = await readRevision();
      const validated = validatedRevision?.(value);
      applied = undefined;
      if (
        publish(value) &&
        (validated === undefined ? before === after : validated === after)
      )
        applied = after;
    } catch (error) {
      applied = undefined;
      throw error;
    }
  };
}
