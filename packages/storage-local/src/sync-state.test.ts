import type { LocalSyncState } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

const own = {
  schemaVersion: 1 as const,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
};
const state: LocalSyncState = {
  workspaceId: own.workspaceId,
  remoteWorkspaceId: "remote",
  remotePrincipalId: "remote-owner",
  serverOrigin: "https://example.test",
  epoch: "epoch",
  cursor: 10,
  version: 1,
};
it("initial account binding is atomic with empty entity/outbox guards and installation ownership", async () => {
  const factory = new IDBFactory();
  const empty = await IndexedDbLocalStore.open("empty-binding", factory);
  try {
    await empty.identity.ensure(own);
    const initial = { ...state, cursor: 0 };
    const results = await Promise.allSettled([
      empty.syncState.bindEmpty!(initial),
      empty.syncState.bindEmpty!(initial),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(await empty.syncState.get(own.workspaceId)).toEqual(initial);
  } finally {
    empty.close();
  }
  const populated = await IndexedDbLocalStore.open(
    "populated-binding",
    factory,
  );
  try {
    const record = {
      workspaceId: own.workspaceId,
      collection: "notes",
      id: "keep",
      version: 1,
      value: { title: "Preserve", bodyMd: "Original" },
    };
    await populated.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity: own,
        entities: [record],
        mutations: [],
        syncState: null,
      },
      own.deviceId,
    );
    await expect(
      populated.syncState.bindEmpty!({ ...state, cursor: 0 }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(
      await populated.metadata.get(own.workspaceId, "notes", "keep"),
    ).toEqual(record);
    expect(await populated.syncState.get(own.workspaceId)).toBeNull();
  } finally {
    populated.close();
  }
});
it("binding saves capture input, enforce installation scope and retain CAS across competing updates", async () => {
  const db = await IndexedDbLocalStore.open("sync-state", new IDBFactory());
  try {
    await db.identity.ensure(own);
    const mutable = { ...state };
    const saved = db.syncState.save(mutable, null);
    Object.assign(mutable, {
      workspaceId: "foreign",
      remotePrincipalId: "foreign",
      cursor: 999,
    });
    await saved;
    expect(await db.syncState.get(own.workspaceId)).toEqual(state);
    expect(await db.syncState.get("foreign")).toBeNull();
    await expect(
      db.syncState.save({ ...state, workspaceId: "foreign" }, null),
    ).rejects.toThrow("VERSION_CONFLICT");
    const outcomes = await Promise.allSettled([
      db.syncState.save({ ...state, version: 2, cursor: 20 }, 1),
      db.syncState.save({ ...state, version: 2, cursor: 30 }, 1),
    ]);
    expect(outcomes.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(await db.syncState.get(own.workspaceId)).toMatchObject({
      version: 2,
      remotePrincipalId: "remote-owner",
    });
    expect(await db.outbox.list(own.workspaceId)).toEqual([]);
  } finally {
    db.close();
  }
});

it("legacy restored binding JSON stays unchanged and malformed remote identities cannot overwrite it", async () => {
  const db = await IndexedDbLocalStore.open("legacy-binding", new IDBFactory());
  try {
    const { remotePrincipalId: _principal, ...legacy } = state;
    await db.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity: own,
        entities: [],
        mutations: [],
        syncState: legacy,
      },
      own.deviceId,
    );
    expect(await db.syncState.get(own.workspaceId)).toEqual(legacy);
    expect(
      (await db.metadata.exportWorkspace!(own.workspaceId)).syncState,
    ).toEqual(legacy);
    for (const remotePrincipalId of ["", "x".repeat(241), 42, {}]) {
      const invalid = { ...state, version: 2 };
      Object.assign(invalid, { remotePrincipalId });
      await expect(db.syncState.save(invalid, 1)).rejects.toThrow(
        "INVALID_WRITE",
      );
    }
    expect(await db.syncState.get(own.workspaceId)).toEqual(legacy);
  } finally {
    db.close();
  }
});
