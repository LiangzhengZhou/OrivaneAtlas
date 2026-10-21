import { type ActorContext, DomainError } from "@arclattice/domain";
import { validateLocalCanonicalKnowledgeManifest } from "./local-canonical-knowledge";
import { localDto } from "./local-dto";
import type {
  LocalJson,
  LocalMetadataStore,
  LocalRecordWrite,
  LocalSyncState,
} from "./local-persistence";

/** No fabricated body. Older body/revision/Wiki sources survive until exact hydration. */
export async function prepareLocalKnowledgeManifestProjection(
  actorInput: ActorContext,
  bindingInput: LocalSyncState,
  collection: "notes" | "library",
  id: string,
  version: number,
  value: LocalJson,
  metadata: LocalMetadataStore,
): Promise<readonly LocalRecordWrite[]> {
  const actor = Object.freeze({ ...actorInput }),
    binding = structuredClone(bindingInput);
  if (
    binding.workspaceId !== actor.workspaceId ||
    !binding.remoteWorkspaceId ||
    !binding.remotePrincipalId ||
    !binding.serverOrigin ||
    !binding.epoch
  )
    throw new DomainError("FORBIDDEN");
  const manifest = validateLocalCanonicalKnowledgeManifest(
    collection,
    id,
    binding.remoteWorkspaceId,
    version,
    value,
  );
  const prefix = collection === "notes" ? "note" : "library";
  const refs = [
    { collection, id },
    { collection: `$local.${prefix}BodyAvailability`, id },
    { collection: `$local.${prefix}Search`, id },
  ];
  const existing = metadata.getMany
    ? await metadata.getMany(actor.workspaceId, refs)
    : await Promise.all(
        refs.map((ref) =>
          metadata.get(actor.workspaceId, ref.collection, ref.id),
        ),
      );
  if (
    existing.length !== refs.length ||
    existing.some(
      (entry, index) =>
        entry &&
        (entry.workspaceId !== actor.workspaceId ||
          entry.collection !== refs[index]?.collection ||
          entry.id !== id),
    )
  )
    throw new DomainError("VALIDATION_ERROR", { field: "knowledgeProjection" });
  const values = [
    { ...manifest, workspaceId: actor.workspaceId },
    {
      state: "MISSING",
      collection,
      id,
      entityVersion: version,
      remoteWorkspaceId: binding.remoteWorkspaceId,
      remotePrincipalId: binding.remotePrincipalId,
      serverOrigin: binding.serverOrigin,
      epoch: binding.epoch,
    },
    {
      text: manifest.title.normalize("NFKC").toLocaleLowerCase(),
      deletedAt: manifest.deletedAt,
    },
  ];
  return refs.map((ref, index) => ({
    expectedVersion: existing[index]?.version ?? null,
    entity: {
      workspaceId: actor.workspaceId,
      collection: ref.collection,
      id,
      version: index === 0 ? version : (existing[index]?.version ?? 0) + 1,
      value: localDto(values[index]),
    },
  }));
}
