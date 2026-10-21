import { expect, type Page } from "@playwright/test";

/** Deterministic storage failure, distinct from a remote synchronization outage. */
export async function setLocalCommandFailure(page: Page, enabled: boolean) {
  await page.evaluate((fail) => {
    const restore = Reflect.get(window, "restoreFixtureOutboxWrites");
    if (typeof restore === "function") restore();
    if (!fail) return;
    const original = IDBObjectStore.prototype.add;
    Reflect.set(window, "restoreFixtureOutboxWrites", () => {
      IDBObjectStore.prototype.add = original;
      Reflect.deleteProperty(window, "restoreFixtureOutboxWrites");
    });
    IDBObjectStore.prototype.add = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "outbox")
        throw new DOMException(
          "Fixture local storage failure",
          "QuotaExceededError",
        );
      return key === undefined
        ? original.call(this, value)
        : original.call(this, value, key);
    };
  }, enabled);
}

export async function activeReplicaIdentity(page: Page) {
  return page.evaluate(async () => {
    function read<T>(request: IDBRequest<T>) {
      return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    const catalog = await read(
      indexedDB.open("orivane-atlas.workspace-catalog"),
    );
    let databaseName: string;
    try {
      const tx = catalog.transaction(["state", "entries"]);
      const selected = await read(tx.objectStore("state").get("active"));
      databaseName = (await read(tx.objectStore("entries").get(selected)))
        .databaseName;
    } finally {
      catalog.close();
    }
    const db = await read(indexedDB.open(databaseName));
    try {
      const value: { workspaceId: string; principalId: string } = await read(
        db.transaction("identity").objectStore("identity").get("default"),
      );
      if (!value?.workspaceId || !value.principalId)
        throw new Error("MISSING_REPLICA_IDENTITY");
      return value;
    } finally {
      db.close();
    }
  });
}

/** Only use before canonical assertions in online scenarios, never offline saves. */
export async function waitForLocalReplay(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          function read<T>(request: IDBRequest<T>) {
            return new Promise<T>((resolve, reject) => {
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
          }
          const catalog = await read(
            indexedDB.open("orivane-atlas.workspace-catalog"),
          );
          let entry: {
            databaseName: string;
            remote?: {
              workspaceId: string;
              principalId: string;
              serverOrigin: string;
            };
          };
          try {
            const tx = catalog.transaction(["state", "entries"]);
            const selected = await read(tx.objectStore("state").get("active"));
            entry = await read(tx.objectStore("entries").get(selected));
          } finally {
            catalog.close();
          }
          if (!entry?.remote) throw new Error("EXPECTED_BOUND_ACCOUNT_REPLICA");
          const db = await read(indexedDB.open(entry.databaseName));
          try {
            const tx = db.transaction(["sync", "outbox"]);
            const [bindings, pending] = await Promise.all([
              read(tx.objectStore("sync").getAll()),
              read(tx.objectStore("outbox").getAll()),
            ]);
            if (
              bindings.length !== 1 ||
              bindings[0].remoteWorkspaceId !== entry.remote.workspaceId ||
              bindings[0].remotePrincipalId !== entry.remote.principalId ||
              bindings[0].serverOrigin !== entry.remote.serverOrigin
            )
              throw new Error("REPLICA_SCOPE_CHANGED");
            // ACK atomically removes commands. Conflicted/rejected/uncertain
            // commands stay present and therefore cannot satisfy this barrier.
            return pending.map((row) => ({
              id: row.id,
              state: row.state,
              entityType: row.entityType,
            }));
          } finally {
            db.close();
          }
        }),
      { message: "active account replica commands have durably ACKed" },
    )
    .toEqual([]);
}
