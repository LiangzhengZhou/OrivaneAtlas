import { type ActorContext, DomainError } from "@arclattice/domain";
import { requireOriginalFileIdentity } from "./files";
import { requireCanonicalFile } from "./local-canonical-file";
import { localObject } from "./local-dto";
import type {
  LocalBlobStore,
  LocalMetadataStore,
  LocalSyncState,
} from "./local-persistence";

/** On-demand original bytes; no metadata, Outbox, revision or cursor mutation. */
export async function hydrateLocalFileBytes(
  actorInput: ActorContext,
  id: string,
  metadata: LocalMetadataStore,
  blobs: LocalBlobStore,
  binding: () => Promise<LocalSyncState>,
  download: (scope: LocalSyncState, id: string) => Promise<Blob>,
) {
  const actor = Object.freeze({ ...actorInput }),
    scope = structuredClone(await binding());
  if (
    scope.workspaceId !== actor.workspaceId ||
    !scope.remoteWorkspaceId ||
    !scope.remotePrincipalId ||
    !scope.serverOrigin ||
    !scope.epoch
  )
    throw new DomainError("FORBIDDEN");
  const check = async () => {
    const current = await binding();
    if (
      current.workspaceId !== scope.workspaceId ||
      current.remoteWorkspaceId !== scope.remoteWorkspaceId ||
      current.remotePrincipalId !== scope.remotePrincipalId ||
      current.serverOrigin !== scope.serverOrigin ||
      current.epoch !== scope.epoch
    )
      throw new DomainError("VERSION_CONFLICT", { field: "fileBinding" });
  };
  const file = await metadata.get(actor.workspaceId, "files", id),
    base = await metadata.get(
      actor.workspaceId,
      "$local.remoteBase",
      JSON.stringify(["files", id]),
    );
  if (
    !file ||
    !base ||
    file.workspaceId !== actor.workspaceId ||
    base.workspaceId !== actor.workspaceId
  )
    throw new DomainError("FORBIDDEN", { field: "remoteFileProvenance" });
  const local = requireCanonicalFile(
      file.value,
      id,
      actor.workspaceId,
      file.version,
    ),
    source = localObject(base.value);
  if (
    source.remoteWorkspaceId !== scope.remoteWorkspaceId ||
    source.remotePrincipalId !== scope.remotePrincipalId ||
    source.serverOrigin !== scope.serverOrigin ||
    source.epoch !== scope.epoch ||
    typeof source.version !== "number" ||
    source.value === undefined
  )
    throw new DomainError("FORBIDDEN", { field: "remoteFileProvenance" });
  const remote = requireCanonicalFile(
    source.value,
    id,
    scope.remoteWorkspaceId,
    source.version,
  );
  if (local.deletedAt || remote.deletedAt) throw new DomainError("NOT_FOUND");
  if (
    (
      [
        "contentHash",
        "size",
        "originalName",
        "blobId",
        "mime",
        "extension",
        "provenance",
        "createdAt",
      ] as const
    ).some((field) => local[field] !== remote[field])
  )
    throw new DomainError("VERSION_CONFLICT", { field: "fileContentIdentity" });
  await check();
  const bytes = await download(scope, id);
  await check();
  if (
    !blobs.digest ||
    bytes.size !== local.size ||
    (await blobs.digest(bytes)) !== local.contentHash
  )
    throw new DomainError("VALIDATION_ERROR", { field: "fileBytes" });
  const latest = await metadata.get(actor.workspaceId, "files", id);
  if (!latest || latest.workspaceId !== actor.workspaceId)
    throw new DomainError("NOT_FOUND");
  const current = requireCanonicalFile(
    latest.value,
    id,
    actor.workspaceId,
    latest.version,
  );
  requireOriginalFileIdentity(local, current);
  if (current.deletedAt) throw new DomainError("NOT_FOUND");
  await check();
  await blobs.put(actor.workspaceId, local.contentHash, bytes);
  await check();
}
