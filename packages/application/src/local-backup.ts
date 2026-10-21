import { localDto, localObject } from "./local-dto";
import type {
  LocalBlobStore,
  LocalMetadataStore,
  LocalWorkspaceArchive,
} from "./local-persistence";

export async function restoreLocalWorkspace(
  bytes: Blob,
  newDeviceId: string,
  metadata: LocalMetadataStore,
  blobs: LocalBlobStore,
) {
  if (
    !metadata.restoreEmptyWorkspace ||
    !metadata.assertEmptyWorkspace ||
    !blobs.digest
  )
    throw new Error("LOCAL_BACKUP_PORT_INCOMPLETE");
  if (bytes.size < 16 || bytes.size > 1152 * 1024 * 1024)
    throw new Error("LOCAL_BACKUP_INVALID");
  const header = new Uint8Array(await bytes.slice(0, 16).arrayBuffer());
  const length = new DataView(header.buffer).getUint32(8, false);
  if (
    new TextDecoder().decode(header.slice(0, 8)) !== "ORIVANE1" ||
    header.slice(12).some((byte) => byte !== 0) ||
    length > 128 * 1024 * 1024 ||
    length + 16 > bytes.size
  )
    throw new Error("LOCAL_BACKUP_INVALID");
  const manifest: unknown = JSON.parse(
    await bytes.slice(16, 16 + length).text(),
  );
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("format" in manifest) ||
    manifest.format !== "orivane-local-workspace" ||
    !("version" in manifest) ||
    manifest.version !== 1 ||
    !("credentialVault" in manifest) ||
    manifest.credentialVault !== "EXCLUDED" ||
    !("archive" in manifest) ||
    !("blobs" in manifest) ||
    !Array.isArray(manifest.blobs)
  )
    throw new Error("LOCAL_BACKUP_INVALID");
  const archive = manifest.archive as LocalWorkspaceArchive;
  const uuid = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  if (
    !archive ||
    archive.schemaVersion !== 2 ||
    !archive.identity ||
    archive.identity.schemaVersion !== 1 ||
    !uuid(archive.identity.workspaceId) ||
    !uuid(archive.identity.principalId) ||
    !uuid(archive.identity.deviceId) ||
    !uuid(newDeviceId) ||
    newDeviceId === archive.identity.deviceId ||
    !Array.isArray(archive.entities) ||
    !Array.isArray(archive.mutations) ||
    archive.entities.length > 100000 ||
    archive.mutations.length > 100000
  )
    throw new Error("LOCAL_BACKUP_INVALID");
  for (const record of archive.entities) {
    if (
      !record ||
      record.workspaceId !== archive.identity.workspaceId ||
      typeof record.collection !== "string" ||
      !record.collection ||
      typeof record.id !== "string" ||
      !record.id ||
      !Number.isSafeInteger(record.version) ||
      record.version < 1
    )
      throw new Error("LOCAL_BACKUP_INVALID");
    localDto(record.value);
  }
  for (const mutation of archive.mutations) {
    if (
      !mutation ||
      mutation.workspaceId !== archive.identity.workspaceId ||
      mutation.principalId !== archive.identity.principalId ||
      typeof mutation.id !== "string" ||
      !mutation.id ||
      typeof mutation.deviceId !== "string" ||
      !["CREATE", "PATCH", "DELETE", "MOVE", "LINK", "UNLINK"].includes(
        mutation.operation,
      ) ||
      typeof mutation.entityType !== "string" ||
      !mutation.entityType ||
      typeof mutation.entityId !== "string" ||
      !mutation.entityId ||
      (mutation.baseVersion !== null &&
        (!Number.isSafeInteger(mutation.baseVersion) ||
          mutation.baseVersion < 1)) ||
      !Number.isSafeInteger(mutation.attemptCount) ||
      mutation.attemptCount < 0 ||
      !validLocalMutationOrder(mutation.order) ||
      typeof mutation.createdAt !== "string" ||
      !Number.isFinite(Date.parse(mutation.createdAt)) ||
      (mutation.lastAttemptAt !== null &&
        (typeof mutation.lastAttemptAt !== "string" ||
          !Number.isFinite(Date.parse(mutation.lastAttemptAt)))) ||
      !["PENDING", "SENDING", "CONFLICT", "REJECTED"].includes(mutation.state)
    )
      throw new Error("LOCAL_BACKUP_INVALID");
    localDto(mutation);
  }
  if (archive.syncState) {
    const sync = archive.syncState;
    if (
      sync.workspaceId !== archive.identity.workspaceId ||
      !Number.isSafeInteger(sync.version) ||
      sync.version < 1 ||
      !Number.isSafeInteger(sync.cursor) ||
      sync.cursor < 0 ||
      (sync.epoch !== null && typeof sync.epoch !== "string") ||
      (sync.remoteWorkspaceId !== null &&
        typeof sync.remoteWorkspaceId !== "string") ||
      (sync.serverOrigin !== null && typeof sync.serverOrigin !== "string") ||
      (sync.remotePrincipalId !== undefined &&
        sync.remotePrincipalId !== null &&
        (typeof sync.remotePrincipalId !== "string" ||
          !sync.remotePrincipalId ||
          sync.remotePrincipalId.length > 240))
    )
      throw new Error("LOCAL_BACKUP_INVALID");
    localDto(sync);
  }
  const verified = new Map<string, Blob>();
  let offset = 0;
  for (const item of manifest.blobs) {
    const descriptor = localObject(localDto(item));
    if (
      typeof descriptor.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(descriptor.hash) ||
      verified.has(descriptor.hash) ||
      descriptor.offset !== offset ||
      typeof descriptor.size !== "number" ||
      !Number.isSafeInteger(descriptor.size) ||
      descriptor.size < 0 ||
      descriptor.size > 100 * 1024 * 1024 ||
      typeof descriptor.mime !== "string" ||
      descriptor.mime.length > 255
    )
      throw new Error("LOCAL_BACKUP_INVALID");
    const content = bytes.slice(
      16 + length + offset,
      16 + length + offset + descriptor.size,
      descriptor.mime,
    );
    if (
      content.size !== descriptor.size ||
      (await blobs.digest(content)) !== descriptor.hash
    )
      throw new Error("LOCAL_BACKUP_HASH_MISMATCH");
    verified.set(descriptor.hash, content);
    offset += descriptor.size;
  }
  if (16 + length + offset !== bytes.size)
    throw new Error("LOCAL_BACKUP_INVALID");
  for (const record of archive.entities) {
    if (
      !record.value ||
      typeof record.value !== "object" ||
      Array.isArray(record.value)
    )
      continue;
    const value = localObject(localDto(record.value));
    if (
      record.collection === "files" &&
      (typeof value.contentHash !== "string" ||
        !verified.has(value.contentHash))
    )
      throw new Error("LOCAL_BACKUP_BLOB_MISSING");
    if (Array.isArray(value.chunkHashes))
      for (const hash of value.chunkHashes)
        if (typeof hash !== "string" || !verified.has(hash))
          throw new Error("LOCAL_BACKUP_BLOB_MISSING");
  }
  // Binary staging can remain orphaned on failure; no workspace is exposed until
  // the empty-target metadata restore commits atomically.
  await metadata.assertEmptyWorkspace();
  for (const [hash, content] of verified)
    await blobs.put(archive.identity.workspaceId, hash, content);
  await metadata.restoreEmptyWorkspace(archive, newDeviceId);
}

/** Versioned binary archive: manifest UTF-8, original bytes in raw sections. */
export async function exportLocalWorkspace(
  workspaceId: string,
  metadata: LocalMetadataStore,
  blobs: LocalBlobStore,
): Promise<Blob> {
  if (!metadata.exportWorkspace || !blobs.listHashes || !blobs.digest)
    throw new Error("LOCAL_BACKUP_PORT_INCOMPLETE");
  const archive = await metadata.exportWorkspace(workspaceId);
  const hashes = new Set<string>();
  for (const entity of archive.entities) {
    const value = entity.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (
      entity.collection === "files" &&
      "contentHash" in value &&
      typeof value.contentHash === "string"
    )
      hashes.add(value.contentHash);
    if ("chunkHashes" in value && Array.isArray(value.chunkHashes))
      for (const hash of value.chunkHashes) {
        if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))
          throw new Error("LOCAL_BACKUP_INVALID_BLOB_REFERENCE");
        hashes.add(hash);
      }
  }
  const parts: Blob[] = [];
  const descriptors: {
    hash: string;
    size: number;
    mime: string;
    offset: number;
  }[] = [];
  let offset = 0;
  for (const hash of [...hashes].sort()) {
    const bytes = await blobs.get(workspaceId, hash);
    if (!bytes || (await blobs.digest(bytes)) !== hash)
      throw new Error("LOCAL_BACKUP_BLOB_MISSING_OR_CORRUPT");
    descriptors.push({ hash, size: bytes.size, mime: bytes.type, offset });
    offset += bytes.size;
    if (offset > 1024 * 1024 * 1024) throw new Error("LOCAL_BACKUP_SIZE_LIMIT");
    parts.push(bytes);
  }
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      format: "orivane-local-workspace",
      version: 1,
      credentialVault: "EXCLUDED",
      archive,
      blobs: descriptors,
    }),
  );
  if (manifest.length > 128 * 1024 * 1024)
    throw new Error("LOCAL_BACKUP_MANIFEST_LIMIT");
  const header = new Uint8Array(16);
  header.set(new TextEncoder().encode("ORIVANE1"));
  new DataView(header.buffer).setUint32(8, manifest.length, false);
  return new Blob([header, manifest, ...parts], {
    type: "application/vnd.orivane.workspace-backup",
  });
}

import { validLocalMutationOrder } from "./local-mutation-order";
