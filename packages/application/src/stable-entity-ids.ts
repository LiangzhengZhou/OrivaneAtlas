import type { ApplicationIdPurpose, IdGenerator } from "./index";
import { requireStableUuid } from "./mutation-receipt";

/** Overrides one primary allocation; revisions/audit retain their ordinary ID source. */
export function stableEntityIds(
  ids: IdGenerator,
  purpose: ApplicationIdPurpose,
  id: string,
): IdGenerator {
  requireStableUuid(id);
  let allocated = false;
  return {
    next: () => ids.next(),
    nextFor: (requested) => {
      if (requested === purpose && !allocated) {
        allocated = true;
        return id;
      }
      return ids.nextFor?.(requested) ?? ids.next();
    },
  };
}
