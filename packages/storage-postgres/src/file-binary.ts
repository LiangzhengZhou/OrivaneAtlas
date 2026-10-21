import {
  type FileBinaryRepository,
  fileBinaryStore,
} from "@arclattice/application";
import type { ActorContext } from "@arclattice/domain";
import type { PoolClient } from "pg";

export function binaryStore(
  client: PoolClient,
  actor: ActorContext,
  guard: () => void,
) {
  const repository: FileBinaryRepository = {
    descriptor: async (hash) => {
      guard();
      const result = await client.query(
        "SELECT size,mime,chunk_size,completed FROM arclattice.file_blob_descriptor WHERE workspace_id=$1 AND content_hash=$2",
        [actor.workspaceId, hash],
      );
      guard();
      const row = result.rows[0];
      return row
        ? {
            workspaceId: actor.workspaceId,
            sha256: hash,
            size: Number(row.size),
            mime: String(row.mime),
            chunkSize: Number(row.chunk_size),
            complete: row.completed === true,
          }
        : null;
    },
    begin: async (upload) => {
      guard();
      await client.query(
        "INSERT INTO arclattice.file_blob_descriptor(workspace_id,content_hash,size,mime,chunk_size) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,content_hash) DO NOTHING",
        [
          actor.workspaceId,
          upload.sha256,
          upload.size,
          upload.mime,
          upload.chunkSize,
        ],
      );
      const value = await repository.descriptor(upload.sha256);
      if (!value) throw new Error("FILE_UPLOAD_NOT_FOUND");
      return value;
    },
    chunks: async (hash) => {
      guard();
      const result = await client.query(
        "SELECT chunk_index,chunk_hash,bytes FROM arclattice.file_blob_chunk WHERE workspace_id=$1 AND content_hash=$2 ORDER BY chunk_index",
        [actor.workspaceId, hash],
      );
      guard();
      return result.rows.map((row) => {
        if (!(row.bytes instanceof Uint8Array))
          throw new Error("FILE_BYTES_CORRUPT");
        return {
          index: Number(row.chunk_index),
          hash: String(row.chunk_hash),
          bytes: new Uint8Array(row.bytes),
        };
      });
    },
    putChunk: async (hash, chunk) => {
      guard();
      await client.query(
        "INSERT INTO arclattice.file_blob_chunk VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,content_hash,chunk_index) DO NOTHING",
        [
          actor.workspaceId,
          hash,
          chunk.index,
          chunk.hash,
          chunk.bytes.length,
          Buffer.from(chunk.bytes),
        ],
      );
      const result = await client.query(
        "SELECT chunk_hash FROM arclattice.file_blob_chunk WHERE workspace_id=$1 AND content_hash=$2 AND chunk_index=$3",
        [actor.workspaceId, hash, chunk.index],
      );
      guard();
      if (result.rows[0]?.chunk_hash !== chunk.hash)
        throw new Error("FILE_HASH_MISMATCH");
    },
    complete: async (hash) => {
      guard();
      const result = await client.query(
        "UPDATE arclattice.file_blob_descriptor SET completed=TRUE WHERE workspace_id=$1 AND content_hash=$2",
        [actor.workspaceId, hash],
      );
      guard();
      if (!result.rowCount) throw new Error("FILE_UPLOAD_NOT_FOUND");
    },
  };
  return fileBinaryStore(actor.workspaceId, repository);
}
