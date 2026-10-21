import type {
  LocalMutation,
  LocalReplicaCommit,
  LocalSyncState,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { defaultNavigationPreference } from "../../domain/src/index";
import { IndexedDbLocalStore } from "./indexed-db";

const own = {
  schemaVersion: 1 as const,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
};
const binding: LocalSyncState = {
  workspaceId: own.workspaceId,
  remoteWorkspaceId: "remote",
  serverOrigin: "https://example.test",
  epoch: "epoch",
  cursor: 10,
  version: 1,
};
const mutation: LocalMutation = {
  id: "mutation",
  workspaceId: own.workspaceId,
  principalId: own.principalId,
  deviceId: own.deviceId,
  entityType: "items",
  entityId: "task",
  operation: "CREATE",
  baseVersion: null,
  payload: { title: "Local" },
  createdAt: "2026-10-13T00:00:00Z",
  attemptCount: 1,
  lastAttemptAt: "2026-10-13T00:01:00Z",
  state: "SENDING",
};
function input(): LocalReplicaCommit {
  return {
    workspaceId: own.workspaceId,
    principalId: own.principalId,
    expectedWorkspaceVersion: 1,
    binding,
    nextCursor: 11,
    acknowledgement: {
      mutationId: mutation.id,
      deviceId: own.deviceId,
      attemptCount: 1,
      lastAttemptAt: mutation.lastAttemptAt!,
    },
    records: [
      {
        expectedVersion: null,
        entity: {
          workspaceId: own.workspaceId,
          collection: "$local.remoteBase",
          id: JSON.stringify(["items", "task"]),
          version: 1,
          value: {
            remoteWorkspaceId: "remote",
            collection: "items",
            id: "task",
            version: 1,
            mutationId: mutation.id,
            value: { title: "Canonical" },
          },
        },
      },
    ],
  };
}
it("replica rejects another principal's navigation before changing entity, cursor or original attempt", async () => {
  const { store } = await fixture();
  try {
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    await expect(
      store.replica.commit({
        ...input(),
        records: [
          {
            expectedVersion: null,
            entity: {
              workspaceId: own.workspaceId,
              collection: "navigationPreference",
              id: "foreign-principal",
              version: 1,
              value: { ...defaultNavigationPreference(), version: 1 },
            },
          },
        ],
      }),
    ).rejects.toThrow("INVALID_WRITE");
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
  } finally {
    store.close();
  }
});
async function fixture(
  later = false,
  deviceId = own.deviceId,
  organization = false,
) {
  const capturedMutation = organization
    ? { ...mutation, entityType: "organization", entityId: "WORK:task" }
    : mutation;
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("replica", factory);
  await store.metadata.restoreEmptyWorkspace!(
    {
      schemaVersion: 2,
      identity: own,
      syncState: binding,
      entities: [
        {
          workspaceId: own.workspaceId,
          collection: "$local.workspace",
          id: "revision",
          version: 1,
          value: { revision: 1 },
        },
        {
          workspaceId: own.workspaceId,
          collection: organization ? "organization" : "items",
          id: organization ? "WORK:task" : "task",
          version: 1,
          value: { title: "Local" },
        },
      ],
      mutations: later
        ? [
            capturedMutation,
            {
              ...mutation,
              id: "later",
              state: "PENDING",
              attemptCount: 0,
              lastAttemptAt: null,
            },
          ]
        : [capturedMutation],
    },
    deviceId,
  );
  return { factory, store };
}

it("organization ACK validates composite identity without accepting another kind or changing the original attempt", async () => {
  const { store } = await fixture(false, own.deviceId, true);
  try {
    const commit = input();
    const base = commit.records[0];
    if (!base) throw new Error("MISSING_BASE");
    const entityId = JSON.stringify(["organization", "WORK:task"]);
    const canonical = {
      kind: "WORK",
      id: "task",
      workspaceId: "remote",
      version: 1,
      archived: true,
      folder: "",
      updatedAt: mutation.createdAt,
      updatedBy: "human",
    };
    const rejectedValue = {
      remoteWorkspaceId: "remote",
      collection: "organization",
      id: "WORK:task",
      version: 1,
      mutationId: mutation.id,
      value: { ...canonical, kind: "NOTE" },
    };
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    await expect(
      store.replica.commit({
        ...commit,
        records: [
          {
            ...base,
            entity: { ...base.entity, id: entityId, value: rejectedValue },
          },
        ],
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
    const acceptedValue = {
      remoteWorkspaceId: "remote",
      collection: "organization",
      id: "WORK:task",
      version: 1,
      mutationId: mutation.id,
      value: canonical,
    };
    await store.replica.commit({
      ...commit,
      records: [
        {
          ...base,
          entity: { ...base.entity, id: entityId, value: acceptedValue },
        },
      ],
    });
    expect(await store.outbox.list(own.workspaceId)).toEqual([]);
    expect(await store.syncState.get(own.workspaceId)).toMatchObject({
      cursor: 11,
      version: 2,
    });
  } finally {
    store.close();
  }
});

it("rejects a changed remote principal without changing records, cursor or pending mutations", async () => {
  const { store } = await fixture();
  try {
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    await expect(
      store.replica.commit({
        ...input(),
        binding: { ...binding, remotePrincipalId: "another-account" },
      }),
    ).rejects.toThrow();
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
  } finally {
    store.close();
  }
});

it("atomically persists canonical base and cursor, removes only accepted mutation and survives reopen", async () => {
  const { store, factory } = await fixture(true);
  try {
    await store.replica.commit(input());
    expect(
      (await store.outbox.list(own.workspaceId)).map((entry) => entry.id),
    ).toEqual(["later"]);
    expect(await store.syncState.get(own.workspaceId)).toEqual({
      ...binding,
      cursor: 11,
      version: 2,
    });
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    await expect(
      store.replica.commit({
        ...input(),
        binding: { ...binding, cursor: 11, version: 2 },
        expectedWorkspaceVersion: 2,
        records: [],
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
    store.close();
    const reopened = await IndexedDbLocalStore.open("replica", factory);
    try {
      expect(await reopened.metadata.exportWorkspace!(own.workspaceId)).toEqual(
        before,
      );
    } finally {
      reopened.close();
    }
  } finally {
    store.close();
  }
});

it("rejects stale scope, binding, attempt and revision with zero partial changes", async () => {
  const { store } = await fixture();
  try {
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    const original = input();
    for (const candidate of [
      { ...original, principalId: "foreign" },
      { ...original, expectedWorkspaceVersion: null },
      { ...original, binding: { ...binding, epoch: "other" } },
      {
        ...original,
        acknowledgement: { ...original.acknowledgement!, attemptCount: 2 },
      },
      { ...original, records: [] },
    ]) {
      await expect(store.replica.commit(candidate)).rejects.toThrow(
        "VERSION_CONFLICT",
      );
      expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
        before,
      );
    }
  } finally {
    store.close();
  }
});

it("protects later edits from canonical overwrite while allowing an accepted remote base", async () => {
  const { store } = await fixture(true);
  try {
    const original = input();
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    await expect(
      store.replica.commit({
        ...original,
        records: [
          ...original.records,
          {
            expectedVersion: 1,
            entity: {
              workspaceId: own.workspaceId,
              collection: "items",
              id: "task",
              version: 2,
              value: { title: "Canonical" },
            },
          },
        ],
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
    await store.replica.commit(original);
    expect(
      (await store.metadata.get(own.workspaceId, "items", "task"))?.value,
    ).toEqual({ title: "Local" });
  } finally {
    store.close();
  }
});

it("detaches caller input before callbacks and rejects foreign canonical data", async () => {
  const { store } = await fixture();
  try {
    const original = input();
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    const record = original.records[0]!;
    await expect(
      store.replica.commit({
        ...original,
        records: [
          {
            ...record,
            entity: {
              ...record.entity,
              value: {
                remoteWorkspaceId: "remote",
                collection: "items",
                id: "task",
                version: 1,
                mutationId: mutation.id,
                value: { id: "task", workspaceId: "foreign", version: 1 },
              },
            },
          },
        ],
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
    const mutable = structuredClone(original);
    const promise = store.replica.commit(mutable);
    Object.assign(mutable, { principalId: "foreign", nextCursor: 99 });
    Object.assign(mutable.binding, { epoch: "changed" });
    await promise;
    expect(await store.syncState.get(own.workspaceId)).toEqual({
      ...binding,
      cursor: 11,
      version: 2,
    });
  } finally {
    store.close();
  }
});

it("commits ordinary pull records without generating user mutations", async () => {
  const { store } = await fixture();
  try {
    const original = input();
    const { acknowledgement: _ack, ...pull } = original;
    await store.replica.commit({
      ...pull,
      records: [
        {
          expectedVersion: null,
          entity: {
            workspaceId: own.workspaceId,
            collection: "items",
            id: "remote-task",
            version: 7,
            value: {
              title: "Remote",
              workspaceId: own.workspaceId,
              id: "remote-task",
              version: 7,
            },
          },
        },
      ],
    });
    expect(
      (await store.metadata.get(own.workspaceId, "items", "remote-task"))
        ?.version,
    ).toBe(7);
    expect(await store.outbox.list(own.workspaceId)).toEqual([mutation]);
    expect((await store.syncState.get(own.workspaceId))?.cursor).toBe(11);
  } finally {
    store.close();
  }
});

it("acknowledges restored original-device mutations without rewriting their IDs", async () => {
  const restoredDevice = "44444444-4444-4444-8444-444444444444";
  const { store } = await fixture(true, restoredDevice);
  try {
    expect((await store.identity.get())?.deviceId).toBe(restoredDevice);
    const before = await store.outbox.list(own.workspaceId);
    expect(before.every((entry) => entry.deviceId === own.deviceId)).toBe(true);
    await expect(
      store.replica.commit({
        ...input(),
        acknowledgement: {
          ...input().acknowledgement!,
          deviceId: restoredDevice,
        },
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await store.outbox.list(own.workspaceId)).toEqual(before);
    await store.replica.commit(input());
    expect(await store.outbox.list(own.workspaceId)).toEqual(
      before.filter((entry) => entry.id === "later"),
    );
    expect((await store.syncState.get(own.workspaceId))?.cursor).toBe(11);
  } finally {
    store.close();
  }
});

it("acknowledges a complete effect batch atomically and rolls back every receipt if one attempt mismatches", async () => {
  const { store } = await fixture(true);
  try {
    await store.outbox.transition({
      workspaceId: own.workspaceId,
      mutationId: "later",
      binding: {
        version: 1,
        remoteWorkspaceId: "remote",
        serverOrigin: "https://example.test",
      },
      expectedState: "PENDING",
      expectedAttemptCount: 0,
      expectedLastAttemptAt: null,
      nextState: "SENDING",
      at: "2026-10-13T00:01:00Z",
    });
    const { acknowledgement: first, ...original } = input();
    const batch: LocalReplicaCommit = {
      ...original,
      acknowledgements: [first!, { ...first!, mutationId: "later" }],
      records: [
        {
          expectedVersion: null,
          entity: {
            workspaceId: own.workspaceId,
            collection: "$local.remoteBase",
            id: JSON.stringify(["items", "task"]),
            version: 1,
            value: {
              remoteWorkspaceId: "remote",
              collection: "items",
              id: "task",
              version: 2,
              mutationIds: ["mutation", "later"],
              value: {
                id: "task",
                workspaceId: "remote",
                version: 2,
                title: "Canonical batch",
              },
            },
          },
        },
        {
          expectedVersion: 1,
          entity: {
            workspaceId: own.workspaceId,
            collection: "items",
            id: "task",
            version: 2,
            value: {
              id: "task",
              workspaceId: own.workspaceId,
              version: 2,
              title: "Canonical batch",
            },
          },
        },
      ],
    };
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    await expect(
      store.replica.commit({
        ...batch,
        acknowledgements: [
          first!,
          { ...first!, mutationId: "later", attemptCount: 2 },
        ],
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
    await store.replica.commit(batch);
    expect(await store.outbox.list(own.workspaceId)).toEqual([]);
    expect(
      (await store.metadata.get(own.workspaceId, "items", "task"))?.value,
    ).toEqual({
      id: "task",
      workspaceId: own.workspaceId,
      version: 2,
      title: "Canonical batch",
    });
    expect(await store.syncState.get(own.workspaceId)).toEqual({
      ...binding,
      cursor: 11,
      version: 2,
    });
  } finally {
    store.close();
  }
});
