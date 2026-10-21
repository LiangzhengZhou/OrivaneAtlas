import { type ActorContext, DomainError } from "@arclattice/domain";
import { remoteBodyUnavailable } from "./local-body-availability";
import { localObject } from "./local-dto";
import type { LocalMetadataStore, LocalSyncState } from "./local-persistence";

/** Remote FTS may supplement only unchanged, unhydrated metadata in this binding.
 * Loaded/edited/deleted local content remains authoritative. No body is downloaded.
 */
export async function remoteUnhydratedSearchIds(
  actor: ActorContext,
  binding: LocalSyncState,
  collection: "notes" | "library",
  ids: readonly string[],
  metadata: Pick<LocalMetadataStore, "get">,
) {
  if (binding.workspaceId !== actor.workspaceId || !binding.remotePrincipalId)
    throw new DomainError("FORBIDDEN");
  const accepted: string[] = [];
  for (const id of new Set(ids)) {
    if (typeof id !== "string" || !id || id.length > 240)
      throw new DomainError("VALIDATION_ERROR");
    const manifest = await metadata.get(actor.workspaceId, collection, id);
    if (!manifest) continue;
    const value = localObject(manifest.value);
    if (value.deletedAt || value.bodyState !== "UNLOADED") continue;
    const availability = await metadata.get(
      actor.workspaceId,
      `$local.${collection === "notes" ? "note" : "library"}BodyAvailability`,
      id,
    );
    if (!availability) continue;
    const state = localObject(availability.value);
    if (
      state.serverOrigin !== binding.serverOrigin ||
      state.remoteWorkspaceId !== binding.remoteWorkspaceId ||
      state.remotePrincipalId !== binding.remotePrincipalId ||
      state.epoch !== binding.epoch
    )
      continue;
    const base = await metadata.get(
      actor.workspaceId,
      "$local.remoteBase",
      JSON.stringify([collection, id]),
    );
    if (remoteBodyUnavailable(collection, manifest, availability, base))
      accepted.push(id);
  }
  return accepted;
}

/** Derived substring index; normalized text is computed once per content write. */
export function localSearchGrams(text: string): string[] {
  const characters = Array.from(text),
    grams = new Set<string>();
  for (let width = 1; width <= 3; width++)
    for (let index = 0; index + width <= characters.length; index++)
      grams.add(characters.slice(index, index + width).join(""));
  return [...grams];
}
export function localSearchKey(
  workspaceId: string,
  collection: string,
  gram: string,
) {
  return JSON.stringify([workspaceId, collection, gram]);
}
