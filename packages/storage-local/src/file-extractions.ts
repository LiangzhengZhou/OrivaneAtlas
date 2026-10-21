import {
  type FileExtractionStore,
  type FileSearchIndexBuilder,
  type FileSearchRow,
  fileExtractionIndexVersion,
  fileSearchRows,
  type LocalEntity,
  localSearchKey,
  requireCanonicalFile,
  requireFileExtractionDocument,
} from "@arclattice/application";
import { DomainError } from "@arclattice/domain";
import { searchLocalFileChunks } from "./file-extraction-search";

/** Derived records have no business mutation, Activity or Outbox side effects. */
export function localFileExtractions(
  db: IDBDatabase,
  builder: FileSearchIndexBuilder = {
    build: async (document) => fileSearchRows(document),
  },
): FileExtractionStore {
  const run: (
    actor: Parameters<FileExtractionStore["get"]>[0],
    id: string,
    document?: Parameters<FileExtractionStore["publish"]>[1],
    rows?: readonly FileSearchRow[],
    validateOnly?: boolean,
  ) => Promise<Awaited<ReturnType<FileExtractionStore["get"]>>> = (
    actorInput,
    id,
    input,
    rows,
    validateOnly = false,
  ) => {
    const byLocator = new Map(rows?.map((row) => [row.locator, row]));
    const actor = Object.freeze({ ...actorInput }),
      document = input === undefined ? undefined : structuredClone(input);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        ["identity", "entities"],
        document && !validateOnly ? "readwrite" : "readonly",
        ...(document && !validateOnly
          ? [{ durability: "strict" as const }]
          : []),
      );
      let failure: Error | null = null,
        result: Awaited<ReturnType<FileExtractionStore["get"]>> = null;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("LOCAL_TRANSACTION_ABORTED"));
      const fail = (error: unknown) => {
        failure =
          error instanceof Error
            ? error
            : new Error("LOCAL_FILE_EXTRACTION_CORRUPT");
        tx.abort();
      };
      const identity = tx.objectStore("identity").get("default");
      identity.onsuccess = () => {
        try {
          const owner = identity.result;
          if (
            !owner ||
            owner.workspaceId !== actor.workspaceId ||
            owner.principalId !== actor.principalId
          )
            throw new DomainError("FORBIDDEN");
          const entities = tx.objectStore("entities");
          const source: IDBRequest<LocalEntity | undefined> = entities.get([
            actor.workspaceId,
            "files",
            id,
          ]);
          source.onsuccess = () => {
            try {
              const entity = source.result;
              if (!entity || entity.workspaceId !== actor.workspaceId)
                throw new DomainError("NOT_FOUND");
              const file = requireCanonicalFile(
                entity.value,
                id,
                actor.workspaceId,
                entity.version,
              );
              if (file.deletedAt) throw new DomainError("NOT_FOUND");
              if (
                document &&
                (document.workspaceId !== actor.workspaceId ||
                  document.fileId !== id)
              )
                throw new DomainError("FORBIDDEN");
              if (
                document &&
                (document.fileVersion !== file.version ||
                  document.contentHash !== file.contentHash)
              )
                throw new DomainError("VERSION_CONFLICT");
              const valid =
                document === undefined
                  ? undefined
                  : requireFileExtractionDocument(document, file);
              if (validateOnly) return;
              const cached: IDBRequest<LocalEntity | undefined> = entities.get([
                actor.workspaceId,
                "$local.fileExtractions",
                id,
              ]);
              cached.onsuccess = () => {
                try {
                  if (valid) {
                    entities.put({
                      workspaceId: actor.workspaceId,
                      collection: "$local.fileExtractions",
                      id,
                      version: (cached.result?.version ?? 0) + 1,
                      value: valid,
                    });
                    result = valid;
                    const prefix = JSON.stringify([id]).slice(0, -1) + ",";
                    const cleanup = entities.openCursor(
                      IDBKeyRange.bound(
                        [actor.workspaceId, "$local.fileSearch", prefix],
                        [
                          actor.workspaceId,
                          "$local.fileSearch",
                          prefix + "\uffff",
                        ],
                      ),
                    );
                    cleanup.onsuccess = () => {
                      try {
                        const row = cleanup.result;
                        if (row) {
                          row.delete();
                          row.continue();
                          return;
                        }
                        for (const chunk of valid.chunks) {
                          const row = byLocator.get(chunk.locator);
                          if (!row) throw new Error("LOCAL_FILE_INDEX_CORRUPT");
                          const text = row.text;
                          entities.put({
                            workspaceId: actor.workspaceId,
                            collection: "$local.fileSearch",
                            id: JSON.stringify([id, chunk.locator]),
                            version: 1,
                            value: {
                              fileId: id,
                              fileVersion: file.version,
                              contentHash: file.contentHash,
                              indexVersion: fileExtractionIndexVersion,
                              text,
                              chunk,
                            },
                            searchKeys: row.grams.map((gram) =>
                              localSearchKey(
                                actor.workspaceId,
                                "$local.fileSearch",
                                gram,
                              ),
                            ),
                          });
                        }
                      } catch (error) {
                        fail(error);
                      }
                    };
                  } else if (cached.result) {
                    const value = cached.result.value;
                    if (
                      value &&
                      typeof value === "object" &&
                      !Array.isArray(value) &&
                      "fileVersion" in value &&
                      value.fileVersion === file.version &&
                      "contentHash" in value &&
                      value.contentHash === file.contentHash &&
                      "indexVersion" in value &&
                      value.indexVersion === fileExtractionIndexVersion
                    )
                      result = requireFileExtractionDocument(value, file);
                  }
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
  };
  return {
    searchIds: async (actor, query, ids) =>
      (await searchLocalFileChunks(db, actor, query, ids, 100, true)).map(
        (chunk) => chunk.fileId,
      ),
    search: (actor, query, ids, limit) =>
      searchLocalFileChunks(db, actor, query, ids, limit),
    get: (actor, id) => run(actor, id),
    publish: async (actor, document) => {
      // Authorization precedes worker dispatch. The final write rechecks source version/hash.
      const input = structuredClone(document);
      await run(actor, input.fileId, input, undefined, true);
      const rows = structuredClone(await builder.build(input));
      if (
        !Array.isArray(rows) ||
        rows.length !== input.chunks.length ||
        rows.some(
          (row, i) =>
            !row ||
            row.locator !== input.chunks[i]?.locator ||
            typeof row.text !== "string" ||
            row.text.length > 20000 ||
            !Array.isArray(row.grams) ||
            row.grams.length > row.text.length * 3 + 6 ||
            row.grams.some(
              (gram: unknown) =>
                typeof gram !== "string" || !gram || gram.length > 6,
            ),
        )
      )
        throw new Error("LOCAL_FILE_INDEX_CORRUPT");
      await run(actor, input.fileId, input, rows);
    },
  };
}
