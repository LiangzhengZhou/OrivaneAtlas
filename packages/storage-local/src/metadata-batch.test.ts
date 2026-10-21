import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

const own = {
  schemaVersion: 1 as const,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
};

it("batched metadata reads preserve scope, caller order, missing rows and detached input without mutations", async () => {
  const db = await IndexedDbLocalStore.open("metadata-batch", new IDBFactory());
  try {
    await db.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity: own,
        syncState: null,
        mutations: [],
        entities: [
          {
            workspaceId: own.workspaceId,
            collection: "$local.workspace",
            id: "revision",
            version: 1,
            value: { revision: 1 },
          },
          ...["a", "b"].map((id) => ({
            workspaceId: own.workspaceId,
            collection: "items",
            id,
            version: 1,
            value: { title: id },
          })),
        ],
      },
      own.deviceId,
    );
    const baseline = await db.metadata.exportWorkspace!(own.workspaceId);
    const refs = [
      { collection: "items", id: "a" },
      { collection: "items", id: "missing" },
      { collection: "items", id: "b" },
      { collection: "items", id: "a" },
    ];
    const promise = db.metadata.getMany!(own.workspaceId, refs);
    refs[0]!.id = "b";
    const rows = await promise;
    expect(rows.map((row) => row?.id ?? null)).toEqual(["a", null, "b", "a"]);
    const first = rows[0]?.value;
    if (!first || typeof first !== "object" || Array.isArray(first))
      throw new Error("EXPECTED_OBJECT");
    Object.assign(first, { title: "Caller changed" });
    expect(rows[3]?.value).toEqual({ title: "a" });
    expect(await db.metadata.getMany!("foreign", refs)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(await db.metadata.getMany!(own.workspaceId, [])).toEqual([]);
    await expect(db.metadata.getMany!("", refs)).rejects.toThrow(
      "INVALID_WRITE",
    );
    await expect(
      db.metadata.getMany!(own.workspaceId, [{ collection: "", id: "a" }]),
    ).rejects.toThrow("INVALID_WRITE");
    await expect(
      db.metadata.getMany!(
        own.workspaceId,
        Array.from({ length: 8193 }, () => ({ collection: "items", id: "a" })),
      ),
    ).rejects.toThrow("INVALID_WRITE");
    expect(await db.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      baseline,
    );
    expect(await db.outbox.list(own.workspaceId)).toEqual([]);
  } finally {
    db.close();
  }
});
