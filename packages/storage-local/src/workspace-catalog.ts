import {
  defaultWorkspaceEntry,
  requireWorkspaceCatalogEntry,
  type WorkspaceCatalog,
  type WorkspaceCatalogEntry,
} from "@arclattice/application";

type StoredEntry = WorkspaceCatalogEntry & { remoteKey?: string };
const remoteKey = (entry: WorkspaceCatalogEntry) =>
  entry.remote
    ? JSON.stringify([
        entry.remote.serverOrigin,
        entry.remote.workspaceId,
        entry.remote.principalId,
      ])
    : undefined;

function readStored(value: StoredEntry): WorkspaceCatalogEntry {
  if (!value) throw new Error("MALFORMED_WORKSPACE_CATALOG");
  const { remoteKey: storedKey, ...input } = value;
  const entry = requireWorkspaceCatalogEntry(input);
  if (remoteKey(entry) !== storedKey)
    throw new Error("MALFORMED_WORKSPACE_CATALOG");
  return entry;
}

/** Separate durable catalog preserves existing workspace databases byte-for-byte. */
export class IndexedDbWorkspaceCatalog implements WorkspaceCatalog {
  private constructor(private readonly db: IDBDatabase) {}
  static async open(
    name = "orivane-atlas.workspace-catalog",
    factory: IDBFactory = indexedDB,
  ) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        const entries = request.result.createObjectStore("entries", {
          keyPath: "id",
        });
        entries.createIndex("remoteKey", "remoteKey", { unique: true });
        request.result.createObjectStore("state");
      };
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("WORKSPACE_CATALOG_BLOCKED"));
      };
    });
    const catalog = new IndexedDbWorkspaceCatalog(db);
    db.onversionchange = () => db.close();
    try {
      await catalog.transaction<void>((entries, state, done) => {
        const request = state.get("active");
        request.onsuccess = () => {
          if (request.result === undefined) {
            entries.add(defaultWorkspaceEntry);
            state.add("default", "active");
          }
          done();
        };
      });
      return catalog;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  private transaction<T>(
    action: (
      entries: IDBObjectStore,
      state: IDBObjectStore,
      done: (value: T) => void,
      fail: (error: Error) => void,
    ) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["entries", "state"], "readwrite", {
        durability: "strict",
      });
      let result: T, failure: Error | undefined;
      const fail = (error: Error) => {
        failure = error;
        tx.abort();
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("WORKSPACE_CATALOG_ABORTED"));
      tx.onerror = () => {
        /* Abort reports the transaction error. */
      };
      try {
        action(
          tx.objectStore("entries"),
          tx.objectStore("state"),
          (value) => {
            result = value;
          },
          fail,
        );
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("WORKSPACE_CATALOG_FAILED"),
        );
      }
    });
  }
  active() {
    return this.transaction<WorkspaceCatalogEntry>(
      (entries, state, done, fail) => {
        const selected = state.get("active");
        selected.onsuccess = () => {
          if (typeof selected.result !== "string")
            return fail(new Error("MALFORMED_WORKSPACE_CATALOG"));
          const request = entries.get(selected.result);
          request.onsuccess = () => {
            try {
              done(readStored(request.result));
            } catch {
              fail(new Error("MALFORMED_WORKSPACE_CATALOG"));
            }
          };
        };
      },
    );
  }
  list() {
    return this.transaction<WorkspaceCatalogEntry[]>(
      (entries, _state, done, fail) => {
        const request = entries.getAll();
        request.onsuccess = () => {
          try {
            done((request.result as StoredEntry[]).map(readStored));
          } catch {
            fail(new Error("MALFORMED_WORKSPACE_CATALOG"));
          }
        };
      },
    );
  }
  reserveRemote(input: WorkspaceCatalogEntry) {
    const entry = requireWorkspaceCatalogEntry(input),
      key = remoteKey(entry);
    if (!key) return Promise.reject(new Error("INVALID_REMOTE_WORKSPACE"));
    return this.transaction<WorkspaceCatalogEntry>(
      (entries, _state, done, fail) => {
        const request = entries.index("remoteKey").get(key);
        request.onsuccess = () => {
          if (request.result) {
            try {
              done(readStored(request.result));
            } catch {
              fail(new Error("MALFORMED_WORKSPACE_CATALOG"));
            }
          } else {
            entries.add({ ...entry, remoteKey: key });
            done(entry);
          }
        };
      },
    );
  }
  select(id: string, expectedActiveDatabase: string) {
    return this.transaction<void>((entries, state, done, fail) => {
      const active = state.get("active");
      active.onsuccess = () => {
        const current = entries.get(active.result);
        current.onsuccess = () => {
          try {
            readStored(current.result);
          } catch {
            return fail(new Error("MALFORMED_WORKSPACE_CATALOG"));
          }
          if (current.result?.databaseName !== expectedActiveDatabase)
            return fail(new Error("VERSION_CONFLICT"));
          const target = entries.get(id);
          target.onsuccess = () => {
            try {
              readStored(target.result);
            } catch {
              return fail(new Error("MALFORMED_WORKSPACE_CATALOG"));
            }
            state.put(id, "active");
            done();
          };
        };
      };
    });
  }
}
