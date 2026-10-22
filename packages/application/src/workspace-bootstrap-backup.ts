import { type ActorContext, DomainError } from "@arclattice/domain";
import { exportLocalWorkspace } from "./local-backup";
import type {
  LocalBlobStore,
  LocalMetadataStore,
  LocalSyncState,
} from "./local-persistence";
import type { WorkspaceMergeBackupStore } from "./workspace-merge-backup";

/** Preserve an existing replica before completing its missing initial snapshot. */
export async function preserveReplicaBootstrapBackup(
  actor: ActorContext,
  binding: LocalSyncState,
  revision: number | null,
  remoteCursor: number,
  ports: {
    metadata: LocalMetadataStore;
    blobs: LocalBlobStore;
    store: WorkspaceMergeBackupStore;
    assertScope(): void;
    id(): string;
    now(): string;
  },
) {
  if (!ports.metadata.exportWorkspace || !ports.blobs.digest)
    throw new Error("LOCAL_BACKUP_PORT_INCOMPLETE");
  const check = async () => {
    ports.assertScope();
    const current = await ports.metadata.get(
      actor.workspaceId,
      "$local.workspace",
      "revision",
    );
    if ((current?.version ?? null) !== revision)
      throw new DomainError("VERSION_CONFLICT");
    ports.assertScope();
  };
  await check();
  const archive = await ports.metadata.exportWorkspace(actor.workspaceId);
  if (!archive.entities.length && !archive.mutations.length) return;
  const bytes = await exportLocalWorkspace(
    actor.workspaceId,
    ports.metadata,
    ports.blobs,
  );
  await check();
  const hash = await ports.blobs.digest(bytes),
    id = ports.id();
  if (
    !binding.remoteWorkspaceId ||
    !binding.remotePrincipalId ||
    !binding.serverOrigin ||
    !binding.epoch
  )
    throw new DomainError("FORBIDDEN");
  await ports.store.save({
    id,
    sourceWorkspaceId: actor.workspaceId,
    sourcePrincipalId: actor.principalId,
    sourceRevision: revision ?? 0,
    targetWorkspaceId: binding.remoteWorkspaceId,
    targetPrincipalId: binding.remotePrincipalId,
    targetOrigin: binding.serverOrigin,
    targetEpoch: binding.epoch,
    targetRevision: remoteCursor,
    createdAt: ports.now(),
    sha256: hash,
    bytes,
  });
  const saved = await ports.store.get(id);
  if (
    !saved ||
    saved.sha256 !== hash ||
    (await ports.blobs.digest(saved.bytes)) !== hash
  )
    throw new Error("MERGE_BACKUP_VERIFICATION_FAILED");
  await check();
}
