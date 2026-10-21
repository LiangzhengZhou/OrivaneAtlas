import type { DatabaseSync } from "node:sqlite";
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

export function extractionStore(
  db: DatabaseSync,
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
      const expression = input.terms
        .map((term) => `"${term.replaceAll('"', '""')}"`)
        .join(" AND ");
      return db
        .prepare(
          `SELECT DISTINCT c.file_id FROM file_extraction_fts JOIN file_extraction_chunk c ON c.id=file_extraction_fts.rowid JOIN file_extraction d ON d.workspace_id=c.workspace_id AND d.file_id=c.file_id JOIN library_file f ON f.workspace_id=d.workspace_id AND f.id=d.file_id WHERE file_extraction_fts MATCH ? AND c.workspace_id=? AND c.file_id IN (${input.fileIds.map(() => "?").join(",")}) AND d.file_version=f.version AND d.content_hash=json_extract(f.payload,'$.contentHash') AND json_extract(f.payload,'$.deletedAt') IS NULL ORDER BY c.file_id`,
        )
        .all(expression, actor.workspaceId, ...input.fileIds)
        .map((row) => String(row.file_id));
    },
    search: async (context, query, ids, limit) => {
      const input = fileExtractionSearchInput(query, ids, limit);
      authorize(context);
      if (!input.terms.length || !input.fileIds.length) return [];
      const expression = input.terms
        .map((term) => `"${term.replaceAll('"', '""')}"`)
        .join(" AND ");
      const rows = db
        .prepare(
          `SELECT c.payload FROM file_extraction_fts JOIN file_extraction_chunk c ON c.id=file_extraction_fts.rowid JOIN file_extraction d ON d.workspace_id=c.workspace_id AND d.file_id=c.file_id JOIN library_file f ON f.workspace_id=d.workspace_id AND f.id=d.file_id WHERE file_extraction_fts MATCH ? AND c.workspace_id=? AND c.file_id IN (${input.fileIds.map(() => "?").join(",")}) AND d.file_version=f.version AND d.content_hash=json_extract(f.payload,'$.contentHash') AND json_extract(f.payload,'$.deletedAt') IS NULL ORDER BY bm25(file_extraction_fts),c.file_id,c.locator LIMIT ?`,
        )
        .all(expression, actor.workspaceId, ...input.fileIds, input.limit);
      const result = [];
      for (const row of rows) {
        const chunk = JSON.parse(String(row.payload));
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
      const row = db
        .prepare(
          "SELECT file_version,content_hash,index_version,payload FROM file_extraction WHERE workspace_id=? AND file_id=?",
        )
        .get(actor.workspaceId, id);
      if (
        !row ||
        Number(row.file_version) !== file.version ||
        row.content_hash !== file.contentHash ||
        Number(row.index_version) !== fileExtractionIndexVersion
      )
        return null;
      return requireFileExtractionDocument(
        JSON.parse(String(row.payload)),
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
      db.prepare(
        "INSERT INTO file_extraction VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id,file_id) DO UPDATE SET file_version=excluded.file_version,content_hash=excluded.content_hash,index_version=excluded.index_version,payload=excluded.payload",
      ).run(
        actor.workspaceId,
        file.id,
        file.version,
        file.contentHash,
        value.indexVersion,
        JSON.stringify(value),
      );
      db.prepare(
        "DELETE FROM file_extraction_chunk WHERE workspace_id=? AND file_id=?",
      ).run(actor.workspaceId, file.id);
      const insert = db.prepare(
        "INSERT INTO file_extraction_chunk (workspace_id,file_id,locator,text,title,payload) VALUES (?,?,?,?,?,?)",
      );
      for (const chunk of value.chunks)
        insert.run(
          actor.workspaceId,
          file.id,
          chunk.locator,
          fileExtractionSearchText(chunk.text),
          chunk.title === undefined
            ? null
            : fileExtractionSearchText(chunk.title),
          JSON.stringify(chunk),
        );
    },
  };
}
