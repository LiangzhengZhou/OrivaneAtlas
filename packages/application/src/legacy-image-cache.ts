import { type ActorContext, DomainError } from "@arclattice/domain";
import { localObject } from "./local-dto";
import { requireRasterImage } from "./local-image-assets";
import type {
  LocalBlobStore,
  LocalMetadataStore,
  LocalSyncState,
} from "./local-persistence";
import { LocalStorageError } from "./local-persistence";
import type { LocalReplicaStore } from "./local-replica";

interface CachedImage {
  contentHash: string;
  size: number;
  mime: string;
}
const contentHashPattern = /^[a-f0-9]{64}$/;
/** Derived cache only. Original Markdown, legacy assets and Outbox remain untouched. */
export async function readLegacyImage(
  actor: ActorContext,
  id: string,
  ports: {
    binding(): Promise<LocalSyncState>;
    metadata: LocalMetadataStore;
    blobs: LocalBlobStore;
    replica: LocalReplicaStore;
    offline: boolean;
    download(binding: LocalSyncState): Promise<Blob>;
    /**
     * Revalidates an already cached copy against the authoritative server. The
     * server performs the same access check as the byte route, so an online
     * denial never falls back to local bytes. Absent on older servers/adapters.
     */
    revalidateCache?(
      binding: LocalSyncState,
      contentHash: string,
    ): Promise<boolean>;
  },
): Promise<Blob> {
  const scope = structuredClone(await ports.binding());
  if (
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    scope.workspaceId !== actor.workspaceId ||
    !scope.remoteWorkspaceId ||
    !scope.remotePrincipalId ||
    !scope.serverOrigin ||
    !scope.epoch
  )
    throw new DomainError("FORBIDDEN");
  const key = JSON.stringify([
    actor.principalId,
    scope.serverOrigin,
    scope.remoteWorkspaceId,
    scope.remotePrincipalId,
    scope.epoch,
    id,
  ]);
  const check = async () => {
    const current = await ports.binding();
    if (
      [
        "workspaceId",
        "remoteWorkspaceId",
        "remotePrincipalId",
        "serverOrigin",
        "epoch",
      ].some(
        (field) =>
          current[field as keyof LocalSyncState] !==
          scope[field as keyof LocalSyncState],
      )
    )
      throw new DomainError("FORBIDDEN");
    return current;
  };
  const readCacheRecord = async (): Promise<CachedImage | null> => {
    const record = await ports.metadata.get(
      actor.workspaceId,
      "$local.legacyImage",
      key,
    );
    if (!record || record.workspaceId !== actor.workspaceId) return null;
    const value = localObject(record.value);
    if (
      typeof value.contentHash !== "string" ||
      !contentHashPattern.test(value.contentHash) ||
      typeof value.size !== "number" ||
      typeof value.mime !== "string"
    )
      return null;
    return {
      contentHash: value.contentHash,
      size: value.size,
      mime: value.mime,
    };
  };
  const readCachedBlob = async (cached: CachedImage): Promise<Blob | null> => {
    const blob = await ports.blobs.get(actor.workspaceId, cached.contentHash);
    if (
      !blob ||
      blob.size !== cached.size ||
      blob.type !== cached.mime ||
      !ports.blobs.digest ||
      (await ports.blobs.digest(blob)) !== cached.contentHash
    )
      return null;
    try {
      await requireRasterImage(blob);
    } catch {
      return null;
    }
    return blob;
  };
  if (ports.offline) {
    const record = await ports.metadata.get(
      actor.workspaceId,
      "$local.legacyImage",
      key,
    );
    if (!record || record.workspaceId !== actor.workspaceId)
      throw new DomainError("NOT_FOUND");
    const value = localObject(record.value);
    if (
      typeof value.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.contentHash) ||
      typeof value.size !== "number" ||
      typeof value.mime !== "string"
    )
      throw new Error("LOCAL_DATA_CORRUPT");
    const blob = await ports.blobs.get(actor.workspaceId, value.contentHash);
    if (!blob || blob.size !== value.size || blob.type !== value.mime)
      throw new Error("LOCAL_BINARY_MISSING");
    if (
      !ports.blobs.digest ||
      (await ports.blobs.digest(blob)) !== value.contentHash
    )
      throw new Error("LOCAL_BINARY_CORRUPT");
    await requireRasterImage(blob);
    await check();
    return blob;
  }
  const cachedRecord = await readCacheRecord();
  if (cachedRecord && ports.revalidateCache) {
    if (await ports.revalidateCache(scope, cachedRecord.contentHash)) {
      const cached = await readCachedBlob(cachedRecord);
      if (cached) {
        await check();
        return cached;
      }
    }
  }
  const blob = await ports.download(scope);
  await requireRasterImage(blob);
  await check();
  if (!ports.blobs.digest) throw new Error("LOCAL_BACKUP_PORT_INCOMPLETE");
  const hash = await ports.blobs.digest(blob);
  // The authoritative bytes match the authorized cache entry: keep it as-is.
  if (hash === cachedRecord?.contentHash) {
    await check();
    return blob;
  }
  await ports.blobs.put(actor.workspaceId, hash, blob);
  for (let attempt = 0; ; attempt++) {
    const binding = await check();
    const revision = await ports.metadata.get(
      actor.workspaceId,
      "$local.workspace",
      "revision",
    );
    const old = await ports.metadata.get(
      actor.workspaceId,
      "$local.legacyImage",
      key,
    );
    try {
      await ports.replica.commit({
        workspaceId: actor.workspaceId,
        principalId: actor.principalId,
        expectedWorkspaceVersion: revision?.version ?? null,
        binding,
        nextCursor: binding.cursor,
        records: [
          {
            expectedVersion: old?.version ?? null,
            entity: {
              workspaceId: actor.workspaceId,
              collection: "$local.legacyImage",
              id: key,
              version: (old?.version ?? 0) + 1,
              value: { contentHash: hash, size: blob.size, mime: blob.type },
            },
          },
        ],
      });
      break;
    } catch (error) {
      if (
        !(error instanceof LocalStorageError) ||
        error.code !== "VERSION_CONFLICT" ||
        attempt >= 2
      )
        throw error;
    }
  }
  await check();
  return blob;
}
