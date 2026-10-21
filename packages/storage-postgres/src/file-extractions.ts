import {
  type FileExtractionStore,
  fileExtractionIndexVersion,
  fileExtractionSearchInput,
  fileExtractionSearchText,
  requireFileExtractionDocument,
} from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  type LibraryFile,
} from "@arclattice/domain";
import type { PoolClient } from "pg";

export function extractionStore(
  client: PoolClient,
  actor: ActorContext,
  guard: () => void,
  getFile: (id: string) => Promise<LibraryFile>,
): FileExtractionStore {
  const authorize = (context: ActorContext) => {
    guard();
    if (
      context.workspaceId !== actor.workspaceId ||
      context.principalId !== actor.principalId
    )
      throw new DomainError("FORBIDDEN");
  };
  return {
    searchIds: async (context, query, ids) => {
      const input = fileExtractionSearchInput(query, ids, 100);
      authorize(context);
      if (!input.terms.length || !input.fileIds.length) return [];
      const rows = (
        await client.query(
          "SELECT DISTINCT c.file_id FROM arclattice.file_extraction_chunk c JOIN arclattice.file_extraction d ON d.workspace_id=c.workspace_id AND d.file_id=c.file_id JOIN arclattice.library_file f ON f.workspace_id=d.workspace_id AND f.id=d.file_id WHERE c.search_vector @@ plainto_tsquery('simple',$1) AND c.workspace_id=$2 AND c.file_id=ANY($3::text[]) AND d.file_version=f.version AND d.content_hash=f.payload->>'contentHash' AND f.payload->>'deletedAt' IS NULL ORDER BY c.file_id",
          [input.terms.join(" "), actor.workspaceId, input.fileIds],
        )
      ).rows;
      guard();
      return rows.map((row) => String(row.file_id));
    },
    search: async (context, query, ids, limit) => {
      const input = fileExtractionSearchInput(query, ids, limit);
      authorize(context);
      if (!input.terms.length || !input.fileIds.length) return [];
      const rows = (
        await client.query(
          "SELECT c.payload FROM arclattice.file_extraction_chunk c JOIN arclattice.file_extraction d ON d.workspace_id=c.workspace_id AND d.file_id=c.file_id JOIN arclattice.library_file f ON f.workspace_id=d.workspace_id AND f.id=d.file_id WHERE c.search_vector @@ plainto_tsquery('simple',$1) AND c.workspace_id=$2 AND c.file_id=ANY($3::text[]) AND d.file_version=f.version AND d.content_hash=f.payload->>'contentHash' AND f.payload->>'deletedAt' IS NULL ORDER BY ts_rank(c.search_vector,plainto_tsquery('simple',$1)) DESC,c.file_id,c.locator LIMIT $4",
          [
            input.terms.join(" "),
            actor.workspaceId,
            input.fileIds,
            input.limit,
          ],
        )
      ).rows;
      guard();
      const result = [];
      for (const row of rows) {
        const chunk =
          typeof row.payload === "string"
            ? JSON.parse(row.payload)
            : row.payload;
        const file = await getFile(String(chunk.fileId));
        guard();
        result.push(
          requireFileExtractionDocument(
            {
              workspaceId: file.workspaceId,
              fileId: file.id,
              fileVersion: file.version,
              contentHash: file.contentHash,
              indexVersion: fileExtractionIndexVersion,
              chunks: [chunk],
            },
            file,
          ).chunks[0]!,
        );
      }
      return result;
    },
    get: async (context, id) => {
      authorize(context);
      const file = await getFile(id);
      guard();
      if (file.deletedAt) throw new DomainError("NOT_FOUND");
      const row = (
        await client.query(
          "SELECT file_version,content_hash,index_version,payload FROM arclattice.file_extraction WHERE workspace_id=$1 AND file_id=$2",
          [actor.workspaceId, id],
        )
      ).rows[0];
      guard();
      if (
        !row ||
        Number(row.file_version) !== file.version ||
        row.content_hash !== file.contentHash ||
        Number(row.index_version) !== fileExtractionIndexVersion
      )
        return null;
      return requireFileExtractionDocument(
        typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
        file,
      );
    },
    publish: async (context, input) => {
      const captured = structuredClone(input);
      authorize(context);
      if (captured.workspaceId !== actor.workspaceId)
        throw new DomainError("FORBIDDEN");
      const file = await getFile(captured.fileId);
      guard();
      if (file.deletedAt) throw new DomainError("NOT_FOUND");
      if (
        file.version !== captured.fileVersion ||
        file.contentHash !== captured.contentHash
      )
        throw new DomainError("VERSION_CONFLICT");
      const value = requireFileExtractionDocument(captured, file);
      await client.query(
        "INSERT INTO arclattice.file_extraction VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(workspace_id,file_id) DO UPDATE SET file_version=excluded.file_version,content_hash=excluded.content_hash,index_version=excluded.index_version,payload=excluded.payload",
        [
          actor.workspaceId,
          file.id,
          file.version,
          file.contentHash,
          value.indexVersion,
          JSON.stringify(value),
        ],
      );
      guard();
      await client.query(
        "DELETE FROM arclattice.file_extraction_chunk WHERE workspace_id=$1 AND file_id=$2",
        [actor.workspaceId, file.id],
      );
      guard();
      for (const chunk of value.chunks) {
        await client.query(
          "INSERT INTO arclattice.file_extraction_chunk (workspace_id,file_id,locator,text,title,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
          [
            actor.workspaceId,
            file.id,
            chunk.locator,
            fileExtractionSearchText(chunk.text),
            chunk.title === undefined
              ? null
              : fileExtractionSearchText(chunk.title),
            JSON.stringify(chunk),
          ],
        );
        guard();
      }
    },
  };
}
