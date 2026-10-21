import {
  type FileExtractionStore,
  fileExtractionIndexVersion,
  fileExtractionSearchInput,
  type LocalEntity,
  localSearchKey,
  requireCanonicalFile,
  requireFileExtractionDocument,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
export function searchLocalFileChunks(
  db: IDBDatabase,
  actorInput: ActorContext,
  query: string,
  ids: readonly string[],
  limit: number,
  distinct = false,
): ReturnType<NonNullable<FileExtractionStore["search"]>> {
  const actor = Object.freeze({ ...actorInput }),
    input = fileExtractionSearchInput(query, ids, limit),
    allowed = new Set(input.fileIds);
  const found = new Set<string>();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["identity", "entities"], "readonly");
    let failure: Error | null = null;
    const hits: Awaited<
      ReturnType<NonNullable<FileExtractionStore["search"]>>
    >[number][] = [];
    tx.oncomplete = () => resolve(hits);
    tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error("LOCAL_TRANSACTION_ABORTED"));
    const fail = (error: unknown) => {
      failure =
        error instanceof Error
          ? error
          : new Error("LOCAL_FILE_EXTRACTION_CORRUPT");
      tx.abort();
    };
    const owner = tx.objectStore("identity").get("default");
    owner.onsuccess = () => {
      try {
        if (
          !owner.result ||
          owner.result.workspaceId !== actor.workspaceId ||
          owner.result.principalId !== actor.principalId
        )
          throw new DomainError("FORBIDDEN");
        if (!input.terms.length || !allowed.size) return;
        const entities = tx.objectStore("entities");
        const gram = Array.from(input.terms[0]!).slice(0, 3).join("");
        const cursor = entities
          .index("search")
          .openCursor(
            localSearchKey(actor.workspaceId, "$local.fileSearch", gram),
          );
        cursor.onsuccess = () => {
          try {
            const row = cursor.result;
            if (!row || hits.length >= (distinct ? allowed.size : input.limit))
              return;
            const entity: LocalEntity = row.value,
              value = entity.value;
            if (
              entity.workspaceId !== actor.workspaceId ||
              !value ||
              typeof value !== "object" ||
              Array.isArray(value) ||
              !("fileId" in value) ||
              typeof value.fileId !== "string" ||
              !allowed.has(value.fileId) ||
              (distinct && found.has(value.fileId)) ||
              !("text" in value) ||
              typeof value.text !== "string" ||
              !input.terms.every((term) =>
                (value.text as string).includes(term),
              )
            ) {
              row.continue();
              return;
            }
            const fileId = value.fileId;
            const request: IDBRequest<LocalEntity | undefined> = entities.get([
              actor.workspaceId,
              "files",
              fileId,
            ]);
            request.onsuccess = () => {
              try {
                const source = request.result;
                if (source) {
                  const file = requireCanonicalFile(
                    source.value,
                    fileId,
                    actor.workspaceId,
                    source.version,
                  );
                  if (
                    !file.deletedAt &&
                    "fileVersion" in value &&
                    value.fileVersion === file.version &&
                    "contentHash" in value &&
                    value.contentHash === file.contentHash &&
                    "indexVersion" in value &&
                    value.indexVersion === fileExtractionIndexVersion &&
                    "chunk" in value
                  ) {
                    const document = requireFileExtractionDocument(
                      {
                        workspaceId: file.workspaceId,
                        fileId: file.id,
                        fileVersion: file.version,
                        contentHash: file.contentHash,
                        indexVersion: fileExtractionIndexVersion,
                        chunks: [value.chunk],
                      },
                      file,
                    );
                    hits.push(document.chunks[0]!);
                    found.add(fileId);
                  }
                }
                row.continue();
              } catch (error) {
                fail(error);
              }
            };
          } catch (error) {
            fail(error);
          }
        };
      } catch (error) {
        fail(error);
      }
    };
  });
}
