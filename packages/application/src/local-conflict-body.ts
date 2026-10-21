import { type ActorContext, DomainError } from "@arclattice/domain";
import { validateLocalCanonicalKnowledgeValue } from "./local-canonical-knowledge";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import type {
  LocalEntity,
  LocalMetadataStore,
  LocalMutation,
  LocalSyncState,
} from "./local-persistence";
import type { LocalReplicaCommit, LocalReplicaStore } from "./local-replica";
import { bodyManifest } from "./workspace-bootstrap";

/** Hydrate only the captured remote base. Local body, drafts and pending commands are untouched. */
export async function prepareLocalConflictBody(
  actorInput: ActorContext,
  bindingInput: LocalSyncState,
  capturedInput: LocalEntity,
  bodyInput: unknown,
  metadata: LocalMetadataStore,
): Promise<LocalReplicaCommit> {
  const actor = structuredClone(actorInput),
    binding = structuredClone(bindingInput),
    captured = structuredClone(capturedInput);
  const previous = localObject(captured.value);
  if (
    actor.workspaceId !== binding.workspaceId ||
    !binding.remoteWorkspaceId ||
    !binding.remotePrincipalId ||
    !binding.serverOrigin ||
    !binding.epoch ||
    captured.workspaceId !== actor.workspaceId ||
    captured.collection !== "$local.remoteBase" ||
    previous.remoteWorkspaceId !== binding.remoteWorkspaceId ||
    previous.remotePrincipalId !== binding.remotePrincipalId ||
    previous.serverOrigin !== binding.serverOrigin ||
    previous.epoch !== binding.epoch
  )
    throw new DomainError("FORBIDDEN");
  if (
    (previous.collection !== "notes" && previous.collection !== "library") ||
    !Number.isSafeInteger(captured.version) ||
    captured.version < 1 ||
    captured.version >= Number.MAX_SAFE_INTEGER ||
    typeof previous.id !== "string" ||
    typeof previous.version !== "number" ||
    captured.id !== JSON.stringify([previous.collection, previous.id]) ||
    previous.value == null
  )
    throw new DomainError("VALIDATION_ERROR");
  const body = localDto(bodyInput);
  const canonical = validateLocalCanonicalKnowledgeValue(
    previous.collection,
    previous.id,
    binding.remoteWorkspaceId,
    previous.version,
    body,
  );
  if (
    !equalLocalJson(previous.value, body) &&
    !equalLocalJson(previous.value, localDto(bodyManifest(canonical)))
  )
    throw new DomainError("VERSION_CONFLICT");
  const revision = await metadata.get(
    actor.workspaceId,
    "$local.workspace",
    "revision",
  );
  const fresh = await metadata.get(
    actor.workspaceId,
    "$local.remoteBase",
    captured.id,
  );
  if (!fresh || !equalLocalJson(localDto(fresh), localDto(captured)))
    throw new DomainError("VERSION_CONFLICT");
  if (
    revision &&
    (revision.workspaceId !== actor.workspaceId ||
      revision.collection !== "$local.workspace" ||
      revision.id !== "revision" ||
      localObject(revision.value).revision !== revision.version)
  )
    throw new DomainError("VALIDATION_ERROR");
  return {
    workspaceId: actor.workspaceId,
    principalId: actor.principalId,
    binding,
    expectedWorkspaceVersion: revision?.version ?? null,
    nextCursor: binding.cursor,
    records: [
      {
        expectedVersion: captured.version,
        entity: {
          ...captured,
          version: captured.version + 1,
          value: localDto({ ...previous, value: body }),
        },
      },
    ],
  };
}

export async function hydrateLocalConflictBody(
  actorInput: ActorContext,
  bindingInput: LocalSyncState,
  mutationInput: LocalMutation,
  metadata: LocalMetadataStore,
  replica: LocalReplicaStore,
  read: (
    binding: LocalSyncState,
    collection: "notes" | "library",
    id: string,
  ) => Promise<unknown>,
): Promise<void> {
  const actor = structuredClone(actorInput),
    binding = structuredClone(bindingInput),
    mutation = structuredClone(mutationInput);
  const collection = mutation.entityType;
  if (collection !== "notes" && collection !== "library") return;
  if (
    mutation.workspaceId !== actor.workspaceId ||
    mutation.principalId !== actor.principalId
  )
    throw new DomainError("FORBIDDEN");
  const base = await metadata.get(
    actor.workspaceId,
    "$local.remoteBase",
    JSON.stringify([collection, mutation.entityId]),
  );
  if (!base) return;
  const value = localObject(base.value);
  if (
    typeof value.version !== "number" ||
    value.version <= (mutation.baseVersion ?? 0) ||
    value.value == null ||
    typeof localObject(value.value).bodyMd === "string"
  )
    return;
  const body = await read(
    structuredClone(binding),
    collection,
    mutation.entityId,
  );
  await replica.commit(
    await prepareLocalConflictBody(actor, binding, base, body, metadata),
  );
}
