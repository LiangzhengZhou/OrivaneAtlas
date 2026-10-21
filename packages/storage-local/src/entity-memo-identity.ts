import {
  canonicalEntityMemoId,
  type EntityMemoTarget,
} from "@arclattice/application";
import type { ActorContext } from "@arclattice/domain";

/** Caller must supply the canonical owner/workspace after explicit binding mapping.
 * Never substitute an authenticated remote owner into an unrelated local memo.
 */
export async function deriveEntityMemoId(
  canonical: ActorContext,
  target: EntityMemoTarget,
): Promise<string> {
  return canonicalEntityMemoId(
    canonical,
    target,
    async (input) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-1", new Uint8Array(input)),
      ),
  );
}
