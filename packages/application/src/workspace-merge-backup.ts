import { type ActorContext, DomainError } from "@arclattice/domain";
import { requireStableUuid } from "./mutation-receipt";
import type { WorkspaceConnectionPreview } from "./open-account-workspace";

export interface WorkspaceMergeBackup {
  readonly id: string;
  readonly sourceWorkspaceId: string;
  readonly sourcePrincipalId: string;
  readonly sourceRevision: number;
  readonly targetWorkspaceId: string;
  readonly targetPrincipalId: string;
  readonly targetOrigin: string;
  readonly targetEpoch: string;
  readonly targetRevision: number;
  readonly createdAt: string;
  readonly sha256: string;
  readonly bytes: Blob;
}
export interface WorkspaceMergeBackupStore {
  save(backup: WorkspaceMergeBackup): Promise<void>;
  get(id: string): Promise<WorkspaceMergeBackup | null>;
  list(
    workspaceId: string,
    principalId: string,
  ): Promise<readonly Omit<WorkspaceMergeBackup, "bytes">[]>;
  close(): void;
}

/** Captures a portable, credential-free archive before any import mutation. */
export async function prepareWorkspaceMergeBackup(
  actorInput: ActorContext,
  previewInput: WorkspaceConnectionPreview,
  ports: {
    revision(): Promise<number>;
    archive(): Promise<Blob>;
    digest(bytes: Blob): Promise<string>;
    store: WorkspaceMergeBackupStore;
    assertScope(): void;
    id(): string;
    now(): string;
  },
): Promise<WorkspaceMergeBackup> {
  const actor = Object.freeze({ ...actorInput }),
    preview = structuredClone(previewInput);
  if (actor.workspaceId !== preview.localWorkspaceId)
    throw new DomainError("FORBIDDEN");
  const check = async () => {
    ports.assertScope();
    if ((await ports.revision()) !== preview.localRevision)
      throw new DomainError("VERSION_CONFLICT");
    ports.assertScope();
  };
  await check();
  const bytes = await ports.archive();
  await check();
  const sha256 = await ports.digest(bytes),
    id = ports.id();
  requireStableUuid(id);
  if (!/^[a-f0-9]{64}$/.test(sha256) || bytes.size < 16)
    throw new DomainError("VALIDATION_ERROR");
  const backup: WorkspaceMergeBackup = {
    id,
    sourceWorkspaceId: actor.workspaceId,
    sourcePrincipalId: actor.principalId,
    sourceRevision: preview.localRevision,
    targetWorkspaceId: preview.remoteWorkspaceId,
    targetPrincipalId: preview.remotePrincipalId,
    targetOrigin: preview.serverOrigin,
    targetEpoch: preview.epoch,
    targetRevision: preview.remoteRevision,
    createdAt: ports.now(),
    sha256,
    bytes,
  };
  await check();
  await ports.store.save(backup);
  const stored = await ports.store.get(id);
  if (
    !stored ||
    stored.sha256 !== sha256 ||
    stored.bytes.size !== bytes.size ||
    (await ports.digest(stored.bytes)) !== sha256
  )
    throw new Error("MERGE_BACKUP_VERIFICATION_FAILED");
  await check();
  return backup;
}
