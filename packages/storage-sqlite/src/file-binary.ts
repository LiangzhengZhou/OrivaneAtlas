import type { DatabaseSync } from "node:sqlite";
import {
  type FileBinaryRepository,
  fileBinaryStore,
} from "@arclattice/application";
import type { ActorContext } from "@arclattice/domain";

export function binaryStore(
  db: DatabaseSync,
  actor: ActorContext,
  guard: () => void,
) {
  const repository: FileBinaryRepository = {
    descriptor: async (hash) => {
      guard();
      const row = db
        .prepare(
          "SELECT size,mime,chunk_size,completed FROM file_blob_descriptor WHERE workspace_id=? AND content_hash=?",
        )
        .get(actor.workspaceId, hash);
      return row
        ? {
            workspaceId: actor.workspaceId,
            sha256: hash,
            size: Number(row.size),
            mime: String(row.mime),
            chunkSize: Number(row.chunk_size),
            complete: row.completed === 1,
          }
        : null;
    },
    begin: async (upload) => {
      guard();
      db.prepare(
        "INSERT INTO file_blob_descriptor(workspace_id,content_hash,size,mime,chunk_size) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,content_hash) DO NOTHING",
      ).run(
        actor.workspaceId,
        upload.sha256,
        upload.size,
        upload.mime,
        upload.chunkSize,
      );
      const value = await repository.descriptor(upload.sha256);
      if (!value) throw new Error("FILE_UPLOAD_NOT_FOUND");
      return value;
    },
    chunks: async (hash) => {
      guard();
      return db
        .prepare(
          "SELECT chunk_index,chunk_hash,bytes FROM file_blob_chunk WHERE workspace_id=? AND content_hash=? ORDER BY chunk_index",
        )
        .all(actor.workspaceId, hash)
        .map((row) => {
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
      const row = db
        .prepare(
          "SELECT chunk_hash FROM file_blob_chunk WHERE workspace_id=? AND content_hash=? AND chunk_index=?",
        )
        .get(actor.workspaceId, hash, chunk.index);
      if (row) {
        if (row.chunk_hash !== chunk.hash)
          throw new Error("FILE_HASH_MISMATCH");
        return;
      }
      db.prepare("INSERT INTO file_blob_chunk VALUES(?,?,?,?,?,?)").run(
        actor.workspaceId,
        hash,
        chunk.index,
        chunk.hash,
        chunk.bytes.length,
        chunk.bytes,
      );
    },
    complete: async (hash) => {
      guard();
      const result = db
        .prepare(
          "UPDATE file_blob_descriptor SET completed=1 WHERE workspace_id=? AND content_hash=?",
        )
        .run(actor.workspaceId, hash);
      if (!result.changes) throw new Error("FILE_UPLOAD_NOT_FOUND");
    },
  };
  return fileBinaryStore(actor.workspaceId, repository);
}
