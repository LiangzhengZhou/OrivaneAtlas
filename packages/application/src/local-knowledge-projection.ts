import { type ActorContext, DomainError } from "@arclattice/domain";
import { validateLocalCanonicalKnowledgeValue } from "./local-canonical-knowledge";
import { localDto } from "./local-dto";
import type { LocalWikiIndexer } from "./local-library-store";
import type {
  LocalJson,
  LocalMetadataStore,
  LocalRecordWrite,
  LocalSyncState,
} from "./local-persistence";
import { bodyManifest } from "./workspace-bootstrap";

/** Paired canonical projection; caller supplies the revision/binding CAS and replica transaction. */
export async function prepareLocalKnowledgeProjection(
  actor: ActorContext,
  remoteWorkspaceId: string,
  collection: "notes" | "library",
  id: string,
  version: number,
  value: LocalJson,
  metadata: LocalMetadataStore,
  wiki: LocalWikiIndexer,
  binding: LocalSyncState,
): Promise<readonly LocalRecordWrite[]> {
  actor = Object.freeze({ ...actor });
  binding = structuredClone(binding);
  if (
    binding.workspaceId !== actor.workspaceId ||
    binding.remoteWorkspaceId !== remoteWorkspaceId ||
    !binding.remotePrincipalId ||
    !binding.serverOrigin ||
    !binding.epoch
  )
    throw new DomainError("FORBIDDEN");
  const canonical = validateLocalCanonicalKnowledgeValue(
    collection,
    id,
    remoteWorkspaceId,
    version,
    value,
  );
  const local = { ...canonical, workspaceId: actor.workspaceId };
  const prefix = collection === "notes" ? "note" : "library";
  const refs = [
    { collection, id },
    { collection: `$local.${prefix}Body`, id },
    {
      collection: `$local.${prefix}Revision`,
      id: JSON.stringify([id, version]),
    },
    { collection: `$local.${prefix}Search`, id },
    { collection: `$local.${prefix}BodyAvailability`, id },
    ...(collection === "library"
      ? [{ collection: "$local.wikiSources", id }]
      : []),
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
          entry.id !== refs[index]?.id),
    )
  )
    throw new DomainError("VALIDATION_ERROR", { field: "knowledgeProjection" });
  const values = [
    bodyManifest(local),
    { noteVersion: version, bodyMd: local.bodyMd },
    local,
    {
      text: (local.title + "\n" + local.bodyMd)
        .normalize("NFKC")
        .toLocaleLowerCase(),
      deletedAt: local.deletedAt,
    },
    {
      state: "AVAILABLE",
      collection,
      id,
      entityVersion: version,
      remoteWorkspaceId,
      remotePrincipalId: binding.remotePrincipalId,
      serverOrigin: binding.serverOrigin,
      epoch: binding.epoch,
    },
    ...(collection === "library"
      ? [
          {
            parserVersion: 1,
            sourceVersion: version,
            links:
              local.kind === "DOCUMENT" && !local.deletedAt
                ? wiki.extract(id, local.bodyMd)
                : [],
          },
        ]
      : []),
  ];
  return refs.map((ref, index) => ({
    expectedVersion: existing[index]?.version ?? null,
    entity: {
      workspaceId: actor.workspaceId,
      collection: ref.collection,
      id: ref.id,
      version: index === 0 ? version : (existing[index]?.version ?? 0) + 1,
      value: localDto(values[index]),
    },
  }));
}
