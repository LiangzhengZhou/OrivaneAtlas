import {
  type FileProcessingRecord,
  type FileProcessingStore,
  fileExtractionIndexVersion,
  fileProcessingMatches,
  type LocalEntity,
  requireCanonicalFile,
  requireFileExtractionDocument,
  requireFileProcessingRecord,
} from "@arclattice/application";
import { DomainError } from "@arclattice/domain";

/** Leases and completion are local derived state, never original business mutations. */
export function localFileProcessing(db: IDBDatabase): FileProcessingStore {
  const run = (
    actorInput: Parameters<FileProcessingStore["get"]>[0],
    fileInput: Parameters<FileProcessingStore["get"]>[1],
    operation: "get" | "claim" | "finish",
    leaseId = "",
    at = "",
    retry = false,
    state: FileProcessingRecord["state"] = "RUNNING",
    error: FileProcessingRecord["error"] = null,
  ): Promise<FileProcessingRecord | boolean | null> => {
    const actor = Object.freeze({ ...actorInput }),
      file = structuredClone(fileInput);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        ["identity", "entities"],
        operation === "get" ? "readonly" : "readwrite",
        { durability: "strict" },
      );
      let failure: Error | null = null,
        result: FileProcessingRecord | boolean | null = null;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("LOCAL_TRANSACTION_ABORTED"));
      const fail = (error: unknown) => {
        failure =
          error instanceof Error
            ? error
            : new Error("LOCAL_FILE_PROCESSING_CORRUPT");
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
          if (file.workspaceId !== actor.workspaceId)
            throw new DomainError("FORBIDDEN");
          const entities = tx.objectStore("entities"),
            source: IDBRequest<LocalEntity | undefined> = entities.get([
              actor.workspaceId,
              "files",
              file.id,
            ]);
          source.onsuccess = () => {
            try {
              if (!source.result) throw new DomainError("NOT_FOUND");
              const current = requireCanonicalFile(
                source.result.value,
                file.id,
                actor.workspaceId,
                source.result.version,
              );
              if (current.deletedAt) throw new DomainError("NOT_FOUND");
              if (
                current.version !== file.version ||
                current.contentHash !== file.contentHash
              )
                throw new DomainError("VERSION_CONFLICT");
              const cached: IDBRequest<LocalEntity | undefined> = entities.get([
                actor.workspaceId,
                "$local.fileProcessing",
                file.id,
              ]);
              cached.onsuccess = () => {
                try {
                  if (
                    cached.result &&
                    (cached.result.workspaceId !== actor.workspaceId ||
                      cached.result.id !== file.id ||
                      cached.result.collection !== "$local.fileProcessing" ||
                      !Number.isSafeInteger(cached.result.version) ||
                      cached.result.version < 1)
                  )
                    throw new Error("LOCAL_FILE_PROCESSING_CORRUPT");
                  const old = cached.result
                    ? requireFileProcessingRecord(cached.result.value)
                    : undefined;
                  let matching =
                    old && fileProcessingMatches(old, current) ? old : null;
                  const proceed = () => {
                    try {
                      if (operation === "get") {
                        result = matching;
                        return;
                      }
                      if (!leaseId || leaseId.length > 240)
                        throw new DomainError("VALIDATION_ERROR");
                      if (
                        !["RUNNING", "READY", "FAILED", "PENDING"].includes(
                          state,
                        ) ||
                        (error !== null &&
                          ![
                            "UNSUPPORTED",
                            "MALFORMED",
                            "RESOURCE_LIMIT",
                            "ENCRYPTED",
                            "UNSAFE_CONTENT",
                            "TIMEOUT",
                            "CANCELED",
                          ].includes(error))
                      )
                        throw new DomainError("VALIDATION_ERROR");
                      if (operation === "claim") {
                        const now = Date.parse(at);
                        if (!Number.isFinite(now))
                          throw new DomainError("VALIDATION_ERROR");
                        if (
                          matching &&
                          (matching.state === "READY" ||
                            (matching.state === "FAILED" && !retry) ||
                            (matching.state === "RUNNING" &&
                              Date.parse(matching.leaseUntil) > now))
                        ) {
                          result = false;
                          return;
                        }
                        const value: FileProcessingRecord = {
                          fileId: current.id,
                          fileVersion: current.version,
                          contentHash: current.contentHash,
                          indexVersion: fileExtractionIndexVersion,
                          state: "RUNNING",
                          leaseId,
                          leaseUntil: new Date(now + 60000).toISOString(),
                          error: null,
                        };
                        entities.put({
                          workspaceId: actor.workspaceId,
                          collection: "$local.fileProcessing",
                          id: current.id,
                          version: (cached.result?.version ?? 0) + 1,
                          value,
                        });
                        result = true;
                      } else {
                        if (
                          !matching ||
                          matching.state !== "RUNNING" ||
                          matching.leaseId !== leaseId
                        )
                          throw new DomainError("VERSION_CONFLICT");
                        const complete = () =>
                          entities.put({
                            workspaceId: actor.workspaceId,
                            collection: "$local.fileProcessing",
                            id: current.id,
                            version: cached.result!.version + 1,
                            value: requireFileProcessingRecord({
                              ...matching,
                              state,
                              error,
                            }),
                          });
                        if (state === "READY") {
                          const extracted: IDBRequest<LocalEntity | undefined> =
                            entities.get([
                              actor.workspaceId,
                              "$local.fileExtractions",
                              current.id,
                            ]);
                          extracted.onsuccess = () => {
                            try {
                              if (!extracted.result)
                                throw new DomainError("VALIDATION_ERROR");
                              requireFileExtractionDocument(
                                extracted.result.value,
                                current,
                              );
                              complete();
                            } catch (error) {
                              fail(error);
                            }
                          };
                        } else complete();
                      }
                    } catch (error) {
                      fail(error);
                    }
                  };
                  if (matching?.state === "READY" && operation !== "finish") {
                    // Check metadata only: a removed derived artifact must be rebuilt,
                    // without loading every File body during a background scan.
                    const exists = entities.count([
                      actor.workspaceId,
                      "$local.fileExtractions",
                      current.id,
                    ]);
                    exists.onsuccess = () => {
                      if (!exists.result) matching = null;
                      proceed();
                    };
                  } else proceed();
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
    get: async (actor, file) =>
      (await run(actor, file, "get")) as FileProcessingRecord | null,
    claim: async (actor, file, leaseId, at, retry) =>
      (await run(actor, file, "claim", leaseId, at, retry)) as boolean,
    finish: async (actor, file, leaseId, state, error) => {
      await run(actor, file, "finish", leaseId, "", false, state, error);
    },
  };
}
