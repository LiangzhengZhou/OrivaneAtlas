import {
  canonicalWikiLink,
  compareLocalMutations,
  type FileSearchIndexBuilder,
  type LocalDeletedKnowledgeResolution,
  type LocalDeletedKnowledgeStore,
  type LocalNotificationStore,
  type LocalPendingWorkRebaseStore,
  type LocalReplicaStore,
  localCommandMutationIds,
  localNotificationCollections,
  localSearchGrams,
  localSearchKey,
  remoteBodyUnavailable,
  requireProjectedWikiLink,
  validatePurgedMemoResolution,
  validLocalCommandId,
  validLocalMutationOrder,
} from "@arclattice/application";
import {
  type LocalEntity,
  type LocalMetadataStore,
  type LocalMutation,
  type LocalOutboxStore,
  type LocalRecordWrite,
  LocalStorageError,
  type LocalSyncState,
  type LocalSyncStateStore,
  type LocalWorkspaceArchive,
  type LocalWorkspaceIdentity,
  type LocalWorkspaceIdentityStore,
  type LocalWrite,
} from "./contracts";
import { guardDeletedKnowledge } from "./deleted-knowledge";
import { deriveEntityMemoId } from "./entity-memo-identity";
import { localFileExtractions } from "./file-extractions";
import { localFileProcessing } from "./file-processing";
import { isLocalJson } from "./json";
import type { MetadataReadPort } from "./metadata-read-worker";
import { transitionOutboxBatch } from "./outbox";
import { commitPendingWorkRebase } from "./pending-work-rebase";
import { commitReplica } from "./replica";

export const localMetadataSchemaVersion = 5;

const stores = {
  entities: "entities",
  outbox: "outbox",
  sync: "sync",
  identity: "identity",
};

function indexedEntity(entity: LocalEntity) {
  const value = entity.value;
  const text =
    value &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
      ? value.text
      : null;
  const record: LocalEntity = {
    workspaceId: entity.workspaceId,
    collection: entity.collection,
    id: entity.id,
    version: entity.version,
    value: entity.value,
  };
  if (
    text === null ||
    ![
      "$local.noteSearch",
      "$local.librarySearch",
      "$local.fileSearch",
    ].includes(entity.collection)
  )
    return record;
  return {
    ...record,
    searchKeys: localSearchGrams(text).map((gram) =>
      localSearchKey(entity.workspaceId, entity.collection, gram),
    ),
  };
}

function identity(value: unknown): LocalWorkspaceIdentity {
  if (!isLocalJson(value)) throw new Error("LOCAL_IDENTITY_CORRUPT");
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1
  )
    throw new Error("LOCAL_IDENTITY_CORRUPT");
  const fields = value as Record<string, unknown>;
  const uuid = (identifier: unknown): string => {
    if (
      typeof identifier !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        identifier,
      )
    )
      throw new Error("LOCAL_IDENTITY_CORRUPT");
    return identifier;
  };
  const record: LocalWorkspaceIdentity = {
    schemaVersion: 1,
    workspaceId: uuid(fields.workspaceId),
    principalId: uuid(fields.principalId),
    deviceId: uuid(fields.deviceId),
  };
  if (
    new Set([record.workspaceId, record.principalId, record.deviceId]).size !==
    3
  )
    throw new Error("LOCAL_IDENTITY_CORRUPT");
  return {
    schemaVersion: 1,
    workspaceId: record.workspaceId,
    principalId: record.principalId,
    deviceId: record.deviceId,
  };
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completed(
  tx: IDBTransaction,
  failure?: () => Error | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(failure?.() ?? tx.error ?? new Error("LOCAL_TRANSACTION_ABORTED"));
  });
}

/** Candidate persistence only. Application remains responsible for business policy. */
export class IndexedDbLocalStore {
  private readonly events = new EventTarget();
  private readonly channel: BroadcastChannel | null;
  private closed = false;
  private metadataReaderFailed = false;
  private constructor(
    private readonly db: IDBDatabase,
    private readonly fileIndexBuilder?: FileSearchIndexBuilder,
    private readonly metadataReader?: MetadataReadPort,
  ) {
    this.channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(`orivane.local.${db.name}`);
    if (this.channel)
      this.channel.onmessage = (event) => {
        const value: unknown = event.data;
        if (
          value &&
          typeof value === "object" &&
          "workspaceId" in value &&
          typeof value.workspaceId === "string"
        )
          this.events.dispatchEvent(
            new CustomEvent(
              "kind" in value && value.kind === "FILE_INDEX"
                ? "file-index"
                : "kind" in value && value.kind === "NOTIFICATIONS"
                  ? "notification-changed"
                  : "kind" in value &&
                      value.kind === "FILE_PROCESSING" &&
                      "fileId" in value &&
                      typeof value.fileId === "string"
                    ? "file-processing:" + value.fileId
                    : "changed",
              { detail: value.workspaceId },
            ),
          );
      };
  }

  static async open(
    name: string,
    factory: IDBFactory = indexedDB,
    fileIndexBuilder?: FileSearchIndexBuilder,
    metadataReader?: MetadataReadPort,
  ) {
    const request = factory.open(name, localMetadataSchemaVersion);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        const entities = db.createObjectStore(stores.entities, {
          keyPath: ["workspaceId", "collection", "id"],
        });
        entities.createIndex("collection", ["workspaceId", "collection"]);
        const outbox = db.createObjectStore(stores.outbox, {
          keyPath: ["workspaceId", "id"],
        });
        outbox.createIndex("workspace", "workspaceId");
        db.createObjectStore(stores.sync, { keyPath: "workspaceId" });
      }
      // Append-only v2: installation identity. Existing entities/outbox/sync are untouched.
      if (event.oldVersion < 2) db.createObjectStore(stores.identity);
      if (event.oldVersion < 3) {
        const entities = request.transaction!.objectStore(stores.entities);
        entities.createIndex("search", "searchKeys", { multiEntry: true });
        const cursor = entities.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          row.update(indexedEntity(row.value));
          row.continue();
        };
      }
      if (event.oldVersion < 4)
        request
          .transaction!.objectStore(stores.outbox)
          .createIndex("entity", ["workspaceId", "entityType", "entityId"]);
      if (event.oldVersion >= 3 && event.oldVersion < 5) {
        const cursor = request
          .transaction!.objectStore(stores.entities)
          .openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          row.update(indexedEntity(row.value));
          row.continue();
        };
      }
    };
    const db = await result(request);
    const adapter = new IndexedDbLocalStore(
      db,
      fileIndexBuilder,
      metadataReader,
    );
    db.onversionchange = () => adapter.close();
    return adapter;
  }

  close() {
    this.closed = true;
    this.metadataReader?.close();
    this.channel?.close();
    this.db.close();
  }

  private async read<T>(
    store: string,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ) {
    const tx = this.db.transaction(store, "readonly");
    const done = completed(tx);
    const value = result(operation(tx.objectStore(store)));
    const [record] = await Promise.all([value, done]);
    return record;
  }

  private hintFileProcessing(workspaceId: string, fileId: string) {
    queueMicrotask(() => {
      if (this.closed) return;
      this.channel?.postMessage({
        workspaceId,
        fileId,
        kind: "FILE_PROCESSING",
      });
      this.events.dispatchEvent(
        new CustomEvent("file-processing:" + fileId, { detail: workspaceId }),
      );
    });
  }
  private async listMetadataRecords(workspaceId: string, collection: string) {
    if (this.metadataReader && !this.metadataReaderFailed) {
      try {
        const rows = await this.metadataReader.read({
          database: this.db.name,
          workspaceId,
          collection,
        });
        if (
          rows.some(
            (row) =>
              !row ||
              row.workspaceId !== workspaceId ||
              row.collection !== collection,
          )
        )
          throw new Error("LOCAL_DATA_CORRUPT");
        return rows as LocalEntity[];
      } catch {
        this.metadataReaderFailed = true;
        this.metadataReader.close();
      }
    }
    if (typeof IDBKeyRange === "undefined")
      return this.read<LocalEntity[]>(stores.entities, (store) =>
        store.index("collection").getAll([workspaceId, collection]),
      );
    const tx = this.db.transaction(stores.entities, "readonly");
    const done = completed(tx);
    const store = tx.objectStore(stores.entities);
    const rows: LocalEntity[] = [];
    const next = (after?: string) => {
      const request: IDBRequest<LocalEntity[]> = store.getAll(
        IDBKeyRange.bound(
          after === undefined
            ? [workspaceId, collection]
            : [workspaceId, collection, after],
          [workspaceId, collection, []],
          after !== undefined,
        ),
        128,
      );
      request.onsuccess = () => {
        const batch = request.result;
        rows.push(...batch);
        if (batch.length === 128) next(batch[batch.length - 1]!.id);
      };
    };
    next();
    await done;
    return rows;
  }
  private hintNotifications(workspaceId: string) {
    this.channel?.postMessage({ workspaceId, kind: "NOTIFICATIONS" });
    this.events.dispatchEvent(
      new CustomEvent("notification-changed", { detail: workspaceId }),
    );
  }
  readonly metadata: LocalMetadataStore = {
    detachedReads: true,
    readCanonicalWikiLinks: async (workspaceId, sourceIds) => {
      if (!workspaceId || sourceIds.some((id) => typeof id !== "string" || !id))
        throw new LocalStorageError("INVALID_WRITE");
      if (!sourceIds.length) return [];
      const sources = new Set(sourceIds);
      if (this.metadataReader && !this.metadataReaderFailed) {
        try {
          const rows = await this.metadataReader.read({
            database: this.db.name,
            workspaceId,
            collection: "wikiLinks",
            wikiSourceIds: sourceIds,
          });
          return rows.map((row) => {
            if (
              !row ||
              row.workspaceId !== workspaceId ||
              row.collection !== "wikiLinks" ||
              !Array.isArray(row.value) ||
              row.value.length !== 5
            )
              throw new Error("LOCAL_DATA_CORRUPT");
            return requireProjectedWikiLink(
              {
                sourceDocumentId: row.value[0],
                targetDocumentId: row.value[1],
                targetText: row.value[2],
                alias: row.value[3],
                heading: row.value[4],
              },
              sources,
            );
          });
        } catch {
          this.metadataReaderFailed = true;
          this.metadataReader.close();
        }
      }
      const rows = await this.metadata.list(workspaceId, "wikiLinks");
      return rows.flatMap((row) => {
        const link = canonicalWikiLink(row, workspaceId, sources);
        return link ? [link] : [];
      });
    },
    validateLibraryBodyAvailability: async (workspaceId, checks) => {
      if (
        !workspaceId ||
        checks.length > 32 ||
        checks.some(
          (check) =>
            check.manifest.workspaceId !== workspaceId ||
            check.manifest.collection !== "library",
        )
      )
        throw new LocalStorageError("INVALID_WRITE");
      if (!checks.length) return [];
      const ids = checks.map((check) =>
        JSON.stringify(["library", check.manifest.id]),
      );
      if (this.metadataReader && !this.metadataReaderFailed) {
        try {
          const rows = await this.metadataReader.read({
            database: this.db.name,
            workspaceId,
            collection: "$local.remoteBase",
            ids,
            libraryBodyChecks: checks,
          });
          if (
            rows.length !== checks.length ||
            rows.some(
              (row, index) =>
                !row ||
                row.workspaceId !== workspaceId ||
                row.collection !== "$local.remoteBase" ||
                row.id !== ids[index] ||
                typeof row.value !== "boolean",
            )
          )
            throw new Error("LOCAL_DATA_CORRUPT");
          return rows.map((row) => row!.value as boolean);
        } catch {
          this.metadataReaderFailed = true;
          this.metadataReader.close();
        }
      }
      const rows = await this.metadata.getMany!(
        workspaceId,
        ids.map((id) => ({ collection: "$local.remoteBase", id })),
      );
      return checks.map((check, index) =>
        remoteBodyUnavailable(
          "library",
          check.manifest,
          check.availability,
          rows[index] ?? null,
        ),
      );
    },
    subscribeFileProcessing: (workspaceId, fileId, listener) => {
      const name = "file-processing:" + fileId;
      const changed = (event: Event) => {
        if ((event as CustomEvent<unknown>).detail === workspaceId) listener();
      };
      this.events.addEventListener(name, changed);
      return () => this.events.removeEventListener(name, changed);
    },
    subscribeFileIndex: (workspaceId, listener) => {
      const changed = (event: Event) => {
        if ((event as CustomEvent<unknown>).detail === workspaceId) listener();
      };
      this.events.addEventListener("file-index", changed);
      return () => this.events.removeEventListener("file-index", changed);
    },
    fileProcessing: {
      get: (actor, file) => localFileProcessing(this.db).get(actor, file),
      claim: async (actor, file, leaseId, at, retry) => {
        const claimed = await localFileProcessing(this.db).claim(
          actor,
          file,
          leaseId,
          at,
          retry,
        );
        if (claimed) this.hintFileProcessing(actor.workspaceId, file.id);
        return claimed;
      },
      finish: async (actor, file, leaseId, state, error) => {
        await localFileProcessing(this.db).finish(
          actor,
          file,
          leaseId,
          state,
          error,
        );
        this.hintFileProcessing(actor.workspaceId, file.id);
      },
    },
    fileExtractions: {
      searchIds: (actor, query, ids) =>
        localFileExtractions(this.db).searchIds!(actor, query, ids),
      search: (actor, query, ids, limit) =>
        localFileExtractions(this.db).search!(actor, query, ids, limit),
      get: (actor, id) => localFileExtractions(this.db).get(actor, id),
      publish: async (actor, document) => {
        await localFileExtractions(this.db, this.fileIndexBuilder).publish(
          actor,
          document,
        );
        queueMicrotask(() => {
          if (this.closed) return;
          this.channel?.postMessage({
            workspaceId: actor.workspaceId,
            kind: "FILE_INDEX",
          });
          this.events.dispatchEvent(
            new CustomEvent("file-index", { detail: actor.workspaceId }),
          );
        });
      },
    },
    getMany: async (workspaceId, source) => {
      const refs = structuredClone(source);
      if (
        !workspaceId ||
        refs.length > 8192 ||
        refs.some((ref) => !ref.collection || !ref.id)
      )
        throw new LocalStorageError("INVALID_WRITE");
      if (!refs.length) return [];
      if (
        this.metadataReader &&
        !this.metadataReaderFailed &&
        refs.length <= 32 &&
        refs.every((ref) => ref.collection === "$local.remoteBase")
      ) {
        try {
          const rows = await this.metadataReader.read({
            database: this.db.name,
            workspaceId,
            collection: "$local.remoteBase",
            ids: refs.map((ref) => ref.id),
          });
          if (
            rows.length !== refs.length ||
            rows.some(
              (row, index) =>
                row &&
                (row.workspaceId !== workspaceId ||
                  row.collection !== "$local.remoteBase" ||
                  row.id !== refs[index]!.id),
            )
          )
            throw new Error("LOCAL_DATA_CORRUPT");
          return rows;
        } catch {
          this.metadataReaderFailed = true;
          this.metadataReader.close();
        }
      }
      const tx = this.db.transaction(stores.entities, "readonly");
      const done = completed(tx);
      const store = tx.objectStore(stores.entities);
      let requests: IDBRequest<LocalEntity | undefined>[] = [];
      const result: { dense: Map<string, LocalEntity> | null } = {
        dense: null,
      };
      const readExact = () => {
        requests = refs.map((ref) =>
          store.get([workspaceId, ref.collection, ref.id]),
        );
      };
      if (
        typeof IDBKeyRange !== "undefined" &&
        refs.length >= 8 &&
        refs.length <= 32 &&
        refs.every((ref) => ref.collection === "$local.remoteBase") &&
        new Set(refs.map((ref) => ref.id)).size === refs.length
      ) {
        const ids = refs.map((ref) => ref.id).sort();
        const range = IDBKeyRange.bound(
          [workspaceId, "$local.remoteBase", ids[0]!],
          [workspaceId, "$local.remoteBase", ids[ids.length - 1]!],
        );
        const keys = store.getAllKeys(range, refs.length + 1);
        keys.onsuccess = () => {
          if (
            keys.result.length !== refs.length ||
            keys.result.some(
              (key, index) =>
                !Array.isArray(key) ||
                key.length !== 3 ||
                key[0] !== workspaceId ||
                key[1] !== "$local.remoteBase" ||
                key[2] !== ids[index],
            )
          ) {
            readExact();
            return;
          }
          const values: IDBRequest<LocalEntity[]> = store.getAll(
            range,
            refs.length,
          );
          values.onsuccess = () => {
            if (
              values.result.length !== refs.length ||
              values.result.some(
                (row, index) =>
                  row.workspaceId !== workspaceId ||
                  row.collection !== "$local.remoteBase" ||
                  row.id !== ids[index],
              )
            ) {
              readExact();
              return;
            }
            result.dense = new Map(values.result.map((row) => [row.id, row]));
          };
        };
      } else readExact();
      await done;
      return result.dense
        ? refs.map((ref) => result.dense!.get(ref.id)!)
        : requests.map((request) => request.result ?? null);
    },
    searchCandidates: (workspaceId, collection, gram) =>
      this.read<LocalEntity[]>(stores.entities, (store) =>
        store
          .index("search")
          .getAll(localSearchKey(workspaceId, collection, gram)),
      ),
    assertEmptyWorkspace: async () => {
      const tx = this.db.transaction(Object.values(stores), "readonly");
      const done = completed(tx);
      const counts = Object.values(stores).map((name) =>
        tx.objectStore(name).count(),
      );
      await done;
      if (counts.some((count) => count.result !== 0))
        throw new Error("LOCAL_RESTORE_TARGET_NOT_EMPTY");
    },
    restoreEmptyWorkspace: async (archive, newDeviceId) => {
      const own = identity({ ...archive.identity, deviceId: newDeviceId });
      if (archive.schemaVersion !== 2)
        throw new LocalStorageError("INVALID_WRITE");
      const keys = new Set<string>();
      for (const entity of archive.entities) {
        const key = JSON.stringify([
          entity.workspaceId,
          entity.collection,
          entity.id,
        ]);
        if (
          entity.workspaceId !== own.workspaceId ||
          !entity.collection ||
          !entity.id ||
          !Number.isSafeInteger(entity.version) ||
          entity.version < 1 ||
          !isLocalJson(entity.value) ||
          keys.has(key)
        )
          throw new LocalStorageError("INVALID_WRITE");
        keys.add(key);
      }
      const ids = new Set<string>();
      const commands = new Map(
        archive.entities
          .filter((entity) => entity.collection === "$local.command")
          .map((entity) => [entity.id, entity]),
      );
      for (const mutation of archive.mutations) {
        const command =
          mutation.commandId === undefined
            ? null
            : commands.get(mutation.commandId);
        const members = command
          ? localCommandMutationIds(
              command,
              own.workspaceId,
              mutation.principalId,
            )
          : null;
        if (
          mutation.workspaceId !== own.workspaceId ||
          !mutation.id ||
          ids.has(mutation.id) ||
          !isLocalJson(mutation.payload) ||
          (mutation.basePayload !== undefined &&
            !isLocalJson(mutation.basePayload)) ||
          !validLocalMutationOrder(mutation.order) ||
          !validLocalCommandId(mutation.commandId) ||
          (mutation.commandId !== undefined && !members?.includes(mutation.id))
        )
          throw new LocalStorageError("INVALID_WRITE");
        ids.add(mutation.id);
      }
      if (
        archive.syncState &&
        archive.syncState.workspaceId !== own.workspaceId
      )
        throw new LocalStorageError("INVALID_WRITE");
      const projected = archive.entities.map(indexedEntity);
      const tx = this.db.transaction(Object.values(stores), "readwrite", {
        durability: "strict",
      });
      const done = completed(tx);
      let occupied = false;
      let remaining = Object.values(stores).length;
      for (const name of Object.values(stores)) {
        const request = tx.objectStore(name).count();
        request.onsuccess = () => {
          if (request.result) {
            occupied = true;
            tx.abort();
            return;
          }
          if (--remaining !== 0) return;
          tx.objectStore(stores.identity).add(own, "default");
          for (const record of projected)
            tx.objectStore(stores.entities).add(record);
          for (const mutation of archive.mutations)
            tx.objectStore(stores.outbox).add(mutation);
          if (archive.syncState)
            tx.objectStore(stores.sync).add(archive.syncState);
        };
      }
      try {
        await done;
      } catch (error) {
        if (occupied) throw new Error("LOCAL_RESTORE_TARGET_NOT_EMPTY");
        throw error;
      }
    },
    exportWorkspace: async (workspaceId): Promise<LocalWorkspaceArchive> => {
      const tx = this.db.transaction(Object.values(stores), "readonly");
      const done = completed(tx);
      const identities = tx.objectStore(stores.identity).get("default");
      const entities: IDBRequest<LocalEntity[]> = tx
        .objectStore(stores.entities)
        .getAll();
      const mutations = tx
        .objectStore(stores.outbox)
        .index("workspace")
        .getAll(workspaceId);
      const sync = tx.objectStore(stores.sync).get(workspaceId);
      await done;
      const own = identity(identities.result);
      if (own.workspaceId !== workspaceId)
        throw new LocalStorageError("INVALID_WRITE");
      return {
        schemaVersion: 2,
        identity: own,
        entities: entities.result.filter(
          (record) => record.workspaceId === workspaceId,
        ),
        mutations: mutations.result,
        syncState: sync.result ?? null,
      };
    },
    repairWikiIndex: (workspaceId, principalId, records) => {
      if (
        !records.some(
          (value) =>
            value.entity.collection === "$local.workspace" &&
            value.entity.id === "revision",
        ) ||
        !records.some(
          (value) => value.entity.collection === "$local.wikiSources",
        ) ||
        records.some(
          (value) =>
            value.entity.collection !== "$local.wikiSources" &&
            !(
              value.entity.collection === "$local.workspace" &&
              value.entity.id === "revision"
            ),
        )
      )
        return Promise.reject(new LocalStorageError("INVALID_WRITE"));
      return this.commit(workspaceId, principalId, [], records, true);
    },
    subscribe: (workspaceId, listener) => {
      const changed = (event: Event) => {
        if ((event as CustomEvent<unknown>).detail === workspaceId) listener();
      };
      this.events.addEventListener("changed", changed);
      return () => this.events.removeEventListener("changed", changed);
    },
    get: async (workspaceId, collection, id) =>
      (await this.read<LocalEntity | undefined>(stores.entities, (store) =>
        store.get([workspaceId, collection, id]),
      )) ?? null,
    list: (workspaceId, collection) =>
      this.listMetadataRecords(workspaceId, collection),
    commit: (workspaceId, principalId, writes, records = []) =>
      this.commit(workspaceId, principalId, writes, records),
  };

  readonly identity: LocalWorkspaceIdentityStore = {
    get: async () => {
      const value = await this.read<unknown>(stores.identity, (store) =>
        store.get("default"),
      );
      return value === undefined ? null : identity(value);
    },
    ensure: async (candidate) => {
      const proposed = identity(candidate);
      const tx = this.db.transaction(stores.identity, "readwrite", {
        durability: "strict",
      });
      const done = completed(tx);
      const store = tx.objectStore(stores.identity);
      let selected: LocalWorkspaceIdentity | undefined;
      let failure: Error | undefined;
      const read = store.get("default");
      read.onsuccess = () => {
        try {
          selected =
            read.result === undefined ? proposed : identity(read.result);
          if (read.result === undefined) store.add(selected, "default");
        } catch (error) {
          failure =
            error instanceof Error
              ? error
              : new Error("LOCAL_IDENTITY_CORRUPT");
          tx.abort();
        }
      };
      try {
        await done;
      } catch (error) {
        throw failure ?? error;
      }
      if (!selected) throw new Error("LOCAL_IDENTITY_UNAVAILABLE");
      return structuredClone(selected);
    },
  };

  readonly notifications: LocalNotificationStore = {
    list: (workspaceId) =>
      this.listMetadataRecords(workspaceId, "$local.notification"),
    getPreferences: async (workspaceId) =>
      (await this.read<LocalEntity | undefined>(stores.entities, (store) =>
        store.get([workspaceId, "$local.notificationPreferences", "default"]),
      )) ?? null,
    subscribe: (workspaceId, listener) => {
      const changed = (event: Event) => {
        if ((event as CustomEvent<unknown>).detail === workspaceId) listener();
      };
      this.events.addEventListener("notification-changed", changed);
      return () => {
        this.events.removeEventListener("notification-changed", changed);
      };
    },
    commit: async (workspaceId, writes) => {
      if (!workspaceId || !writes.length)
        throw new LocalStorageError("INVALID_WRITE");
      const seen = new Set<string>();
      for (const { entity, expectedVersion } of writes) {
        const key = entity.collection + "\u0000" + entity.id;
        if (
          seen.has(key) ||
          entity.workspaceId !== workspaceId ||
          !(localNotificationCollections as readonly string[]).includes(
            entity.collection,
          ) ||
          !entity.id ||
          !isLocalJson(entity.value) ||
          !Number.isSafeInteger(entity.version) ||
          (expectedVersion !== null &&
            (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) ||
          entity.version !== (expectedVersion ?? 0) + 1
        )
          throw new LocalStorageError("INVALID_WRITE");
        seen.add(key);
      }
      const tx = this.db.transaction(stores.entities, "readwrite", {
        durability: "strict",
      });
      let failure: Error | null = null;
      const done = completed(tx, () => failure);
      const entities = tx.objectStore(stores.entities);
      for (const write of writes) {
        const read: IDBRequest<LocalEntity | undefined> = entities.get([
          workspaceId,
          write.entity.collection,
          write.entity.id,
        ]);
        read.onsuccess = () => {
          if (failure) return;
          if ((read.result?.version ?? null) !== write.expectedVersion) {
            failure = new LocalStorageError("VERSION_CONFLICT");
            tx.abort();
            return;
          }
          entities.put(indexedEntity(write.entity));
        };
      }
      await done;
      queueMicrotask(() => {
        if (this.closed) return;
        this.hintNotifications(workspaceId);
      });
    },
  };

  private commit(
    workspaceId: string,
    principalId: string,
    writes: readonly LocalWrite[],
    records: readonly LocalRecordWrite[],
    wikiRepair = false,
    deletedKnowledge?: LocalDeletedKnowledgeResolution,
    validatedPurgedMemo = false,
  ) {
    const versions = new Map<string, number>();
    const commandRecords = new Map(
      records
        .filter((record) => record.entity.collection === "$local.command")
        .map((record) => [record.entity.id, record.entity]),
    );
    const commandMembers = new Map<string, string[]>();
    for (const { mutation } of writes) {
      if (mutation.commandId === undefined) continue;
      const members = commandMembers.get(mutation.commandId) ?? [];
      members.push(mutation.id);
      commandMembers.set(mutation.commandId, members);
    }
    for (const [id, members] of commandMembers) {
      const command = commandRecords.get(id);
      const declared =
        command && isLocalJson(command.value)
          ? localCommandMutationIds(command, workspaceId, principalId)
          : null;
      if (
        !declared ||
        declared.length !== members.length ||
        declared.some((member, index) => member !== members[index])
      )
        return Promise.reject(new LocalStorageError("INVALID_WRITE"));
    }
    const grouped = new Map<string, (LocalWrite | LocalRecordWrite)[]>();
    const add = (key: string, write: LocalWrite | LocalRecordWrite) => {
      versions.set(key, write.entity.version);
      const chain = grouped.get(key) ?? [];
      chain.push(write);
      grouped.set(key, chain);
    };
    for (const write of writes) {
      const { entity, mutation, expectedVersion } = write;
      const key = JSON.stringify([entity.collection, entity.id]);
      if (
        !isLocalJson(entity.value) ||
        !isLocalJson(mutation.payload) ||
        (mutation.basePayload !== undefined &&
          !isLocalJson(mutation.basePayload))
      )
        return Promise.reject(new LocalStorageError("INVALID_WRITE"));
      if (
        !workspaceId ||
        !principalId ||
        (versions.has(key) && versions.get(key) !== expectedVersion) ||
        entity.workspaceId !== workspaceId ||
        mutation.workspaceId !== workspaceId ||
        mutation.principalId !== principalId ||
        mutation.entityId !== entity.id ||
        mutation.entityType !== entity.collection ||
        mutation.baseVersion !== expectedVersion ||
        !entity.id ||
        !entity.collection ||
        entity.collection.startsWith("$local.") ||
        !mutation.id ||
        !mutation.deviceId ||
        mutation.state !== "PENDING" ||
        mutation.attemptCount !== 0 ||
        !validLocalCommandId(mutation.commandId) ||
        !validLocalMutationOrder(mutation.order) ||
        !Number.isSafeInteger(entity.version) ||
        (expectedVersion !== null &&
          (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) ||
        entity.version !== (expectedVersion ?? 0) + 1
      )
        return Promise.reject(new LocalStorageError("INVALID_WRITE"));
      add(key, write);
    }
    for (const write of records) {
      const { entity, expectedVersion } = write;
      const key = JSON.stringify([entity.collection, entity.id]);
      if (
        !workspaceId ||
        !principalId ||
        (!writes.length && !wikiRepair && !deletedKnowledge) ||
        (versions.has(key) && versions.get(key) !== expectedVersion) ||
        entity.workspaceId !== workspaceId ||
        (!entity.collection.startsWith("$local.") &&
          !(
            deletedKnowledge &&
            entity.collection ===
              deletedKnowledge.captured.original.entityType &&
            entity.id === deletedKnowledge.captured.original.entityId
          )) ||
        !entity.id ||
        !isLocalJson(entity.value) ||
        !Number.isSafeInteger(entity.version) ||
        (expectedVersion !== null &&
          (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) ||
        (entity.collection.startsWith("$local.") &&
          entity.version !== (expectedVersion ?? 0) + 1)
      )
        return Promise.reject(new LocalStorageError("INVALID_WRITE"));
      add(key, write);
    }
    const projected = new Map(
      [...grouped.values()]
        .flat()
        .map((write) => [write, indexedEntity(write.entity)]),
    );
    const tx = this.db.transaction(
      deletedKnowledge
        ? [stores.entities, stores.outbox, stores.identity, stores.sync]
        : [stores.entities, stores.outbox],
      "readwrite",
      {
        durability: "strict",
      },
    );
    let failure: Error | null = null;
    const done = completed(tx, () => failure);
    const entities = tx.objectStore(stores.entities);
    const outbox = tx.objectStore(stores.outbox);
    if (deletedKnowledge) {
      const abort = (error: Error) => {
        if (!failure) {
          failure = error;
          tx.abort();
        }
      };
      try {
        guardDeletedKnowledge(tx, deletedKnowledge, abort, validatedPurgedMemo);
      } catch (error) {
        abort(
          error instanceof Error
            ? error
            : new LocalStorageError("INVALID_WRITE"),
        );
      }
      if (failure) return done;
    }
    for (const chain of grouped.values()) {
      const write = chain[0]!;
      const read: IDBRequest<LocalEntity | undefined> = entities.get([
        workspaceId,
        write.entity.collection,
        write.entity.id,
      ]);
      read.onsuccess = () => {
        if (failure) return;
        const expected =
          deletedKnowledge?.choice === "RESTORE" &&
          write.entity.collection ===
            deletedKnowledge.captured.original.entityType &&
          write.entity.id === deletedKnowledge.captured.original.entityId
            ? deletedKnowledge.captured.current.version
            : write.expectedVersion;
        if ((read.result?.version ?? null) !== expected) {
          failure = new LocalStorageError("VERSION_CONFLICT", {
            collection: write.entity.collection,
            entityId: write.entity.id,
          });
          tx.abort();
          return;
        }
        for (const next of chain) {
          entities.put(projected.get(next)!);
          if ("mutation" in next) outbox.add(next.mutation);
        }
      };
    }
    return done.then(() => {
      if (!writes.length && !wikiRepair && !deletedKnowledge) return;
      // Hints happen after transaction completion and cannot turn a committed
      // mutation into an apparent failure through an observer exception.
      queueMicrotask(() => {
        if (this.closed) return;
        this.channel?.postMessage({ workspaceId });
        this.events.dispatchEvent(
          new CustomEvent("changed", { detail: workspaceId }),
        );
        if (
          records.some((record) =>
            (localNotificationCollections as readonly string[]).includes(
              record.entity.collection,
            ),
          )
        )
          this.hintNotifications(workspaceId);
      });
    });
  }

  readonly deletedKnowledge: LocalDeletedKnowledgeStore = {
    commit: async (source) => {
      const input = structuredClone(source);
      const purgedMemo = input.captured.original.entityType === "entityMemos";
      if (purgedMemo)
        await validatePurgedMemoResolution(input, {
          forTarget: deriveEntityMemoId,
          nextChangeId: () => {
            throw new Error("UNEXPECTED_MEMO_CHANGE");
          },
        });
      return this.commit(
        input.actor.workspaceId,
        input.actor.principalId,
        input.writes,
        input.records,
        false,
        input,
        purgedMemo,
      );
    },
  };

  readonly replica: LocalReplicaStore = {
    commit: async (input) => {
      const workspaceId = input.workspaceId;
      const changesNotifications = input.records.some((record) =>
        (localNotificationCollections as readonly string[]).includes(
          record.entity.collection,
        ),
      );
      await commitReplica(this.db, input, indexedEntity);
      queueMicrotask(() => {
        if (this.closed) return;
        this.channel?.postMessage({ workspaceId });
        this.events.dispatchEvent(
          new CustomEvent("changed", { detail: workspaceId }),
        );
        if (changesNotifications) this.hintNotifications(workspaceId);
      });
    },
  };

  readonly outbox: LocalOutboxStore = {
    transitionMany: (inputs) => transitionOutboxBatch(this.db, inputs),
    transition: async (source) => {
      const [updated] = await transitionOutboxBatch(this.db, [source]);
      return updated!;
    },
    list: async (workspaceId) =>
      (
        await this.read<LocalMutation[]>(stores.outbox, (store) =>
          store.index("workspace").getAll(workspaceId),
        )
      ).sort(compareLocalMutations),
    recoverSending: async (workspaceId) => {
      const tx = this.db.transaction(stores.outbox, "readwrite", {
        durability: "strict",
      });
      const done = completed(tx);
      const store = tx.objectStore(stores.outbox);
      let count = 0;
      const cursor = store.index("workspace").openCursor(workspaceId);
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const value: LocalMutation = current.value;
        if (value.state === "SENDING") {
          current.update({ ...value, state: "PENDING" });
          count++;
        }
        current.continue();
      };
      await done;
      return count;
    },
  };

  readonly pendingWorkRebase: LocalPendingWorkRebaseStore = {
    commit: async (input) => {
      await commitPendingWorkRebase(this.db, input, indexedEntity);
      queueMicrotask(() => {
        if (this.closed) return;
        const workspaceId = input.actor.workspaceId;
        this.channel?.postMessage({ workspaceId });
        this.events.dispatchEvent(
          new CustomEvent("changed", { detail: workspaceId }),
        );
      });
    },
  };
  readonly syncState: LocalSyncStateStore = {
    get: async (workspaceId) =>
      (await this.read<LocalSyncState | undefined>(stores.sync, (store) =>
        store.get(workspaceId),
      )) ?? null,
    save: (source, expectedVersion) =>
      this.saveSyncState(source, expectedVersion),
    bindEmpty: (source) => this.saveSyncState(source, null, true),
  };
  private saveSyncState(
    source: LocalSyncState,
    expectedVersion: number | null,
    requireEmpty = false,
  ) {
    const state = structuredClone(source);
    if (
      !state.workspaceId ||
      (requireEmpty &&
        (state.cursor !== 0 ||
          !state.remoteWorkspaceId ||
          !state.remotePrincipalId ||
          !state.serverOrigin ||
          !state.epoch)) ||
      !Number.isSafeInteger(state.version) ||
      state.version < 1 ||
      (expectedVersion !== null &&
        (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) ||
      !Number.isSafeInteger(state.cursor) ||
      state.cursor < 0 ||
      (state.remotePrincipalId !== undefined &&
        state.remotePrincipalId !== null &&
        (typeof state.remotePrincipalId !== "string" ||
          !state.remotePrincipalId ||
          state.remotePrincipalId.length > 240)) ||
      state.version !== (expectedVersion ?? 0) + 1
    )
      return Promise.reject(new LocalStorageError("INVALID_WRITE"));
    const tx = this.db.transaction(
      requireEmpty
        ? [stores.sync, stores.identity, stores.entities, stores.outbox]
        : [stores.sync, stores.identity],
      "readwrite",
      {
        durability: "strict",
      },
    );
    let failure: Error | null = null;
    const done = completed(tx, () => failure);
    const store = tx.objectStore(stores.sync);
    let remaining = requireEmpty ? 4 : 2;
    const finish = () => {
      if (!failure && --remaining === 0) store.put(state);
    };
    if (requireEmpty) {
      for (const name of [stores.entities, stores.outbox]) {
        const count = tx.objectStore(name).count();
        count.onsuccess = () => {
          if (failure) return;
          if (count.result !== 0) {
            failure = new LocalStorageError("VERSION_CONFLICT");
            tx.abort();
          } else finish();
        };
      }
    }
    const read: IDBRequest<LocalSyncState | undefined> = store.get(
      state.workspaceId,
    );
    read.onsuccess = () => {
      if ((read.result?.version ?? null) !== expectedVersion) {
        failure = new LocalStorageError("VERSION_CONFLICT");
        tx.abort();
      } else finish();
    };
    const owner: IDBRequest<LocalWorkspaceIdentity | undefined> = tx
      .objectStore(stores.identity)
      .get("default");
    owner.onsuccess = () => {
      if (failure) return;
      if (
        (requireEmpty && !owner.result) ||
        (owner.result && owner.result.workspaceId !== state.workspaceId)
      ) {
        failure = new LocalStorageError("VERSION_CONFLICT");
        tx.abort();
      } else finish();
    };
    return done;
  }
}
