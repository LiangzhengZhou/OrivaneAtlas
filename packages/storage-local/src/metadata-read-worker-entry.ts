import {
  canonicalWikiLink,
  remoteBodyUnavailable,
} from "@arclattice/application";
import type { LocalEntity } from "./contracts";
import { encodeMetadataRows } from "./metadata-read-codec";
import type { MetadataReadRequest } from "./metadata-read-worker";

const connections = new Map<string, Promise<IDBDatabase>>();

export function projectCanonicalWikiRows(
  request: MetadataReadRequest,
  rows: readonly (LocalEntity | null)[],
) {
  if (request.collection !== "wikiLinks" || !request.wikiSourceIds)
    throw new Error("INVALID_READ_WORKER_REQUEST");
  const sources = new Set(request.wikiSourceIds);
  const result: LocalEntity[] = [];
  for (const row of rows) {
    if (!row) throw new Error("LOCAL_DATA_CORRUPT");
    const link = canonicalWikiLink(row, request.workspaceId, sources);
    if (link)
      result.push({
        ...row,
        value: [
          link.sourceDocumentId,
          link.targetDocumentId,
          link.targetText,
          link.alias,
          link.heading,
        ],
      });
  }
  return result;
}

export function validateMetadataBodyRows(
  request: MetadataReadRequest,
  rows: readonly (LocalEntity | null)[],
) {
  const checks = request.libraryBodyChecks;
  if (
    !checks ||
    !request.ids ||
    checks.length !== rows.length ||
    checks.length !== request.ids.length ||
    request.collection !== "$local.remoteBase"
  )
    throw new Error("INVALID_READ_WORKER_REQUEST");
  return checks.map((check, index) => {
    const base = rows[index];
    if (
      check.manifest.workspaceId !== request.workspaceId ||
      check.manifest.collection !== "library" ||
      request.ids![index] !== JSON.stringify(["library", check.manifest.id]) ||
      !base ||
      base.workspaceId !== request.workspaceId ||
      base.collection !== "$local.remoteBase" ||
      base.id !== request.ids![index]
    )
      throw new Error("LOCAL_DATA_CORRUPT");
    return {
      ...base,
      value: remoteBodyUnavailable(
        "library",
        check.manifest,
        check.availability,
        base,
      ),
    };
  });
}
function database(name: string) {
  let connection = connections.get(name);
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onerror = () =>
        reject(new Error("LOCAL_READ_DATABASE_UNAVAILABLE"));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connections.delete(name);
        };
        resolve(db);
      };
    });
    connections.set(name, connection);
  }
  return connection;
}

export async function readMetadataRows(
  db: IDBDatabase,
  request: MetadataReadRequest,
  emitPage?: (rows: readonly (LocalEntity | null)[]) => void,
) {
  return new Promise<(LocalEntity | null)[]>((resolve, reject) => {
    const transaction = db.transaction("entities", "readonly");
    const store = transaction.objectStore("entities");
    const rows: (LocalEntity | null)[] = [];
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("LOCAL_TRANSACTION_ABORTED"));
    transaction.oncomplete = () => resolve(rows);
    if (request.ids) {
      let page: (LocalEntity | null)[] = [];
      request.ids.forEach((id, index) => {
        const reading: IDBRequest<LocalEntity | undefined> = store.get([
          request.workspaceId,
          request.collection,
          id,
        ]);
        reading.onsuccess = () => {
          const value = reading.result ?? null;
          if (!emitPage) rows[index] = value;
          else {
            page.push(value);
            if (page.length === 32 || index === request.ids!.length - 1) {
              emitPage(page);
              page = [];
            }
          }
        };
      });
    } else {
      const page = (after?: string) => {
        const reading: IDBRequest<LocalEntity[]> = store.getAll(
          IDBKeyRange.bound(
            after === undefined
              ? [request.workspaceId, request.collection]
              : [request.workspaceId, request.collection, after],
            [request.workspaceId, request.collection, []],
            after !== undefined,
          ),
          128,
        );
        reading.onsuccess = () => {
          const values = reading.result;
          if (emitPage) {
            if (values.length) emitPage(values);
          } else rows.push(...values);
          if (values.length === 128) page(values[values.length - 1]!.id);
        };
      };
      page();
    }
  });
}

if (typeof document === "undefined" && typeof self !== "undefined")
  self.onmessage = async (
    event: MessageEvent<MetadataReadRequest & { id: number }>,
  ) => {
    const request = event.data;
    try {
      if (
        !request.database ||
        !request.workspaceId ||
        !request.collection ||
        (request.ids &&
          (request.ids.length > 32 || request.ids.some((id) => !id)))
      )
        throw new Error("INVALID_READ_WORKER_REQUEST");
      if (
        request.wikiSourceIds &&
        (request.ids ||
          request.wikiSourceIds.some((id) => typeof id !== "string" || !id))
      )
        throw new Error("INVALID_READ_WORKER_REQUEST");
      const rows = await readMetadataRows(
        await database(request.database),
        request,
        request.ids
          ? undefined
          : (page) =>
              self.postMessage({
                id: request.id,
                page: true,
                ...encodeMetadataRows(
                  request.wikiSourceIds
                    ? projectCanonicalWikiRows(request, page)
                    : page,
                ),
              }),
      );
      self.postMessage(
        request.ids
          ? {
              id: request.id,
              ...encodeMetadataRows(
                request.libraryBodyChecks
                  ? validateMetadataBodyRows(request, rows)
                  : rows,
              ),
            }
          : { id: request.id, done: true },
      );
    } catch {
      self.postMessage({
        id: request.id,
        error: "LOCAL_READ_WORKER_UNAVAILABLE",
      });
    }
  };
