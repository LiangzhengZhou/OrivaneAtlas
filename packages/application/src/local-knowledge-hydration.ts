import { type ActorContext, DomainError } from "@arclattice/domain";
import { remoteBodyUnavailable } from "./local-body-availability";
import { validateLocalCanonicalKnowledgeValue } from "./local-canonical-knowledge";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import { prepareLocalKnowledgeProjection } from "./local-knowledge-projection";
import type { LocalWikiIndexer } from "./local-library-store";
import type {
  LocalMetadataStore,
  LocalMutation,
  LocalSyncState,
} from "./local-persistence";
import type { LocalReplicaCommit } from "./local-replica";
import { bodyManifest } from "./workspace-bootstrap";

/** Exact-version body hydration. Adapter pins authenticated scope around IO; replica pins it at commit. */
export async function prepareLocalKnowledgeHydration(
  actorInput: ActorContext,
  bindingInput: LocalSyncState,
  collection: "notes" | "library",
  id: string,
  version: number,
  bodyInput: unknown,
  pendingInput: readonly LocalMutation[],
  metadata: LocalMetadataStore,
  wiki: LocalWikiIndexer,
): Promise<LocalReplicaCommit> {
  const actor = Object.freeze({ ...actorInput }),
    binding = structuredClone(bindingInput),
    pending = structuredClone(pendingInput),
    body = localDto(bodyInput);
  if (
    binding.workspaceId !== actor.workspaceId ||
    !binding.remoteWorkspaceId ||
    !binding.remotePrincipalId ||
    !binding.serverOrigin ||
    !binding.epoch
  )
    throw new DomainError("FORBIDDEN");
  if (
    pending.some(
      (mutation) =>
        mutation.workspaceId !== actor.workspaceId ||
        mutation.principalId !== actor.principalId,
    )
  )
    throw new DomainError("FORBIDDEN");
  if (
    pending.some(
      (mutation) =>
        mutation.entityType === collection && mutation.entityId === id,
    )
  )
    throw new DomainError("VERSION_CONFLICT");
  const canonical = validateLocalCanonicalKnowledgeValue(
    collection,
    id,
    binding.remoteWorkspaceId,
    version,
    body,
  );
  const baseId = JSON.stringify([collection, id]),
    prefix = collection === "notes" ? "note" : "library";
  const refs = [
    { collection: "$local.workspace", id: "revision" },
    { collection, id },
    { collection: `$local.${prefix}BodyAvailability`, id },
    { collection: "$local.remoteBase", id: baseId },
  ];
  const loaded = metadata.getMany
    ? await metadata.getMany(actor.workspaceId, refs)
    : await Promise.all(
        refs.map((ref) =>
          metadata.get(actor.workspaceId, ref.collection, ref.id),
        ),
      );
  if (
    loaded.length !== refs.length ||
    loaded.some(
      (entry, index) =>
        entry &&
        (entry.workspaceId !== actor.workspaceId ||
          entry.collection !== refs[index]?.collection ||
          entry.id !== refs[index]?.id),
    )
  )
    throw new DomainError("VALIDATION_ERROR", { field: "bodyHydration" });
  const revision = loaded[0] ?? null,
    manifest = loaded[1],
    availability = loaded[2] ?? null,
    base = loaded[3];
  if (revision && localObject(revision.value).revision !== revision.version)
    throw new DomainError("VALIDATION_ERROR", { field: "bodyHydration" });
  if (
    !manifest ||
    !base ||
    manifest.version !== version ||
    !remoteBodyUnavailable(collection, manifest, availability, base)
  )
    throw new DomainError("VERSION_CONFLICT");
  const previous = localObject(base.value);
  if (
    previous.remoteWorkspaceId !== binding.remoteWorkspaceId ||
    previous.remotePrincipalId !== binding.remotePrincipalId ||
    previous.serverOrigin !== binding.serverOrigin ||
    previous.epoch !== binding.epoch ||
    previous.version !== version ||
    previous.value === undefined ||
    !equalLocalJson(previous.value, localDto(bodyManifest(canonical)))
  )
    throw new DomainError("VERSION_CONFLICT");
  const records = await prepareLocalKnowledgeProjection(
    actor,
    binding.remoteWorkspaceId,
    collection,
    id,
    version,
    body,
    metadata,
    wiki,
    binding,
  );
  return {
    workspaceId: actor.workspaceId,
    principalId: actor.principalId,
    binding,
    nextCursor: binding.cursor,
    expectedWorkspaceVersion: revision?.version ?? null,
    records: [
      {
        expectedVersion: base.version,
        entity: {
          ...base,
          version: base.version + 1,
          value: localDto({ ...previous, value: body }),
        },
      },
      ...records,
    ],
  };
}
