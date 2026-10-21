import { DomainError } from "@arclattice/domain";
import type { LocalBlobUpload, LocalChunkBlobStore } from "./local-persistence";

export interface FileBinaryDescriptor extends LocalBlobUpload {
  readonly complete: boolean;
}
export interface FileBinaryChunk {
  readonly index: number;
  readonly hash: string;
  readonly bytes: Uint8Array;
}
/** Scoped to an authenticated request transaction by each persistence adapter. */
export interface FileBinaryRepository {
  descriptor(hash: string): Promise<FileBinaryDescriptor | null>;
  begin(upload: LocalBlobUpload): Promise<FileBinaryDescriptor>;
  chunks(hash: string): Promise<readonly FileBinaryChunk[]>;
  putChunk(hash: string, chunk: FileBinaryChunk): Promise<void>;
  complete(hash: string): Promise<void>;
}

export function fileBinaryStore(
  workspaceId: string,
  repository: FileBinaryRepository,
): LocalChunkBlobStore {
  const scope = (workspace: string, hash: string) => {
    if (workspace !== workspaceId) throw new DomainError("FORBIDDEN");
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))
      throw new Error("INVALID_FILE_HASH");
  };
  const digest = async (bytes: Blob) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer()),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const descriptor = async (workspace: string, hash: string) => {
    scope(workspace, hash);
    const value = await repository.descriptor(hash);
    if (!value) throw new Error("FILE_UPLOAD_NOT_FOUND");
    return value;
  };
  const verified = async (value: FileBinaryDescriptor) => {
    const chunks = await repository.chunks(value.sha256);
    if (chunks.length !== Math.ceil(value.size / value.chunkSize))
      throw new Error("FILE_UPLOAD_INCOMPLETE");
    const parts: Blob[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const bytes = new Blob([new Uint8Array(chunk.bytes)]);
      if (
        chunk.index !== index ||
        bytes.size !==
          Math.min(value.chunkSize, value.size - index * value.chunkSize)
      )
        throw new Error("FILE_UPLOAD_INCOMPLETE");
      if ((await digest(bytes)) !== chunk.hash)
        throw new Error("FILE_HASH_MISMATCH");
      parts.push(bytes);
    }
    const bytes = new Blob(parts, { type: value.mime });
    if (bytes.size !== value.size || (await digest(bytes)) !== value.sha256)
      throw new Error("FILE_HASH_MISMATCH");
    return bytes;
  };
  const store: LocalChunkBlobStore = {
    digest,
    begin: async (upload) => {
      scope(upload.workspaceId, upload.sha256);
      if (
        !Number.isSafeInteger(upload.size) ||
        upload.size < 0 ||
        upload.size > 100 * 1024 * 1024 ||
        !Number.isSafeInteger(upload.chunkSize) ||
        upload.chunkSize < 1 ||
        upload.chunkSize > 262144 ||
        typeof upload.mime !== "string" ||
        !upload.mime ||
        upload.mime.length > 255
      )
        throw new Error("INVALID_FILE_UPLOAD");
      const value = await repository.begin(upload);
      if (value.size !== upload.size || value.chunkSize !== upload.chunkSize)
        throw new Error("FILE_UPLOAD_CONFLICT");
    },
    chunks: async (workspace, hash) => {
      await descriptor(workspace, hash);
      return (await repository.chunks(hash)).map((chunk) => chunk.index);
    },
    putChunk: async (workspace, hash, index, chunkHash, bytes) => {
      const value = await descriptor(workspace, hash);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= Math.ceil(value.size / value.chunkSize) ||
        bytes.size !==
          Math.min(value.chunkSize, value.size - index * value.chunkSize)
      )
        throw new Error("INVALID_FILE_CHUNK");
      if ((await digest(bytes)) !== chunkHash)
        throw new Error("FILE_HASH_MISMATCH");
      await repository.putChunk(hash, {
        index,
        hash: chunkHash,
        bytes: new Uint8Array(await bytes.arrayBuffer()),
      });
    },
    complete: async (workspace, hash) => {
      await verified(await descriptor(workspace, hash));
      await repository.complete(hash);
    },
    get: async (workspace, hash) => {
      scope(workspace, hash);
      const value = await repository.descriptor(hash);
      return value?.complete ? verified(value) : null;
    },
    put: async (workspace, hash, bytes) => {
      scope(workspace, hash);
      if ((await digest(bytes)) !== hash) throw new Error("FILE_HASH_MISMATCH");
      const chunkSize = 262144;
      await store.begin({
        workspaceId: workspace,
        sha256: hash,
        size: bytes.size,
        mime: bytes.type || "application/octet-stream",
        chunkSize,
      });
      for (let index = 0; index < Math.ceil(bytes.size / chunkSize); index++) {
        const chunk = bytes.slice(index * chunkSize, (index + 1) * chunkSize);
        await store.putChunk(
          workspace,
          hash,
          index,
          await digest(chunk),
          chunk,
        );
      }
      await store.complete(workspace, hash);
    },
  };
  return store;
}
