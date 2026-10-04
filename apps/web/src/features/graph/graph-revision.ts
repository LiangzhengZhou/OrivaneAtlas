const revisions = new WeakMap<object, number>();
let nextRevision = 0;

/** Snapshot collections keep identity across unchanged incremental refreshes. */
export function collectionRevision(collection: object): number {
  let revision = revisions.get(collection);
  if (revision === undefined) {
    revision = ++nextRevision;
    revisions.set(collection, revision);
  }
  return revision;
}
