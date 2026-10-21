import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it("pages complete collection reads inside one transaction with exact ordering and scope", async () => {
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const store = await IndexedDbLocalStore.open(
    "metadata-pages",
    new IDBFactory(),
  );
  const identity = {
    schemaVersion: 1 as const,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    deviceId: "33333333-3333-4333-8333-333333333333",
  };
  const entities = Array.from({ length: 513 }, (_, index) => ({
    workspaceId: identity.workspaceId,
    collection: "items",
    id: String(index).padStart(4, "0"),
    version: 1,
    value: { bodyMd: "原始\r\n" + index },
  }));
  try {
    await store.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity,
        syncState: null,
        mutations: [],
        entities: [...entities, { ...entities[0]!, collection: "items-extra" }],
      },
      identity.deviceId,
    );
    const spy = vi.spyOn(IDBObjectStore.prototype, "getAll");
    try {
      const rows = await store.metadata.list(identity.workspaceId, "items");
      expect(rows).toEqual(entities);
      expect(spy).toHaveBeenCalledTimes(5);
      expect(spy.mock.calls.every((args) => args[1] === 128)).toBe(true);
      expect(
        new Set(
          spy.mock.contexts.map(
            (context) => (context as IDBObjectStore).transaction,
          ),
        ).size,
      ).toBe(1);
      Object.assign(rows[128]!.value!, { bodyMd: "Caller changed" });
      expect(await store.metadata.list(identity.workspaceId, "items")).toEqual(
        entities,
      );
      expect(await store.metadata.list("foreign", "items")).toEqual([]);
      expect(await store.metadata.list(identity.workspaceId, "absent")).toEqual(
        [],
      );
      expect(await store.outbox.list(identity.workspaceId)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  } finally {
    store.close();
    vi.unstubAllGlobals();
  }
});
