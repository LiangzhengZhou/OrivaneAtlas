import { expect, it, vi } from "vitest";
import { work } from "../../../tests/fixtures";
import { localDto } from "./local-dto";
import type {
  LocalEntity,
  LocalMetadataStore,
  LocalMutation,
  LocalSyncState,
} from "./local-persistence";
import { prepareLocalWorkPull } from "./local-work-pull";

const actor = { workspaceId: "local", principalId: "owner" };
function fixture() {
  const binding: LocalSyncState = {
    workspaceId: "local",
    remoteWorkspaceId: "remote",
    remotePrincipalId: "remote-owner",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 1,
    version: 1,
  };
  const canonical = { ...work("task", "remote"), version: 2, title: "Remote" };
  const page = {
    epoch: "epoch",
    cursor: 2,
    recovery: false,
    hasMore: false,
    snapshot: null,
    records: [
      {
        seq: 2,
        workspaceId: "remote",
        collection: "items",
        entityId: "task",
        op: "UPSERT",
        version: 2,
      },
    ],
    changes: {
      collections: { items: { upserts: [canonical], removed: [] } },
      values: {},
    },
  };
  const records = new Map<string, LocalEntity>();
  const put = (entity: LocalEntity) =>
    records.set(JSON.stringify([entity.collection, entity.id]), entity);
  put({
    workspaceId: "local",
    collection: "$local.workspace",
    id: "revision",
    version: 10,
    value: { revision: 10 },
  });
  const metadata: LocalMetadataStore = {
    get: vi.fn(async (_w, collection, id) =>
      structuredClone(records.get(JSON.stringify([collection, id])) ?? null),
    ),
    getMany: vi.fn(
      async (_w: string, refs: readonly { collection: string; id: string }[]) =>
        refs.map((ref) =>
          structuredClone(
            records.get(JSON.stringify([ref.collection, ref.id])) ?? null,
          ),
        ),
    ),
    list: vi.fn(async () => []),
    commit: vi.fn(async () => {}),
  };
  return { binding, canonical, page, records, put, metadata };
}
it("an unchanged empty delta does not read metadata or create a redundant local commit", async () => {
  const f = fixture();
  const page = {
    ...f.page,
    cursor: f.binding.cursor,
    records: [],
    changes: { collections: {}, values: {} },
  };
  expect(
    await prepareLocalWorkPull(actor, f.binding, page, [], f.metadata),
  ).toBeNull();
  expect(f.metadata.getMany).not.toHaveBeenCalled();
  expect(f.metadata.commit).not.toHaveBeenCalled();
});

it("prepares canonical Work and provenance with cursor in one batch without user mutations", async () => {
  const f = fixture();
  const prepared = await prepareLocalWorkPull(
    actor,
    f.binding,
    f.page,
    [],
    f.metadata,
  );
  if (!prepared) throw new Error("EXPECTED_WORK_DELTA");
  expect(prepared).toMatchObject({
    expectedWorkspaceVersion: 10,
    nextCursor: 2,
    records: [
      {
        expectedVersion: null,
        entity: {
          collection: "$local.remoteBase",
          value: {
            remotePrincipalId: "remote-owner",
            version: 2,
            value: f.canonical,
          },
        },
      },
      {
        expectedVersion: null,
        entity: {
          collection: "items",
          version: 2,
          value: { workspaceId: "local", title: "Remote" },
        },
      },
    ],
  });
  expect(prepared.acknowledgements).toBeUndefined();
  expect(f.metadata.getMany).toHaveBeenCalledTimes(1);
  expect(f.metadata.get).not.toHaveBeenCalled();
  expect(f.metadata.commit).not.toHaveBeenCalled();
});
it("remote changes update canonical base while retaining pending local content", async () => {
  const f = fixture();
  f.put({
    workspaceId: "local",
    collection: "items",
    id: "task",
    version: 3,
    value: localDto({
      ...f.canonical,
      workspaceId: "local",
      version: 3,
      title: "Local unsent",
    }),
  });
  const pending: LocalMutation = {
    ...actor,
    id: "pending",
    deviceId: "device",
    entityType: "items",
    entityId: "task",
    operation: "PATCH",
    baseVersion: 1,
    payload: { title: "Local unsent" },
    createdAt: "2026-10-13T00:00:00Z",
    state: "PENDING",
    attemptCount: 0,
    lastAttemptAt: null,
  };
  const prepared = await prepareLocalWorkPull(
    actor,
    f.binding,
    f.page,
    [pending],
    f.metadata,
  );
  if (!prepared) throw new Error("EXPECTED_WORK_DELTA");
  expect(prepared.records).toHaveLength(1);
  expect(prepared.records[0]?.entity.collection).toBe("$local.remoteBase");
  expect(prepared.nextCursor).toBe(2);
  expect(
    f.records.get(JSON.stringify(["items", "task"]))?.value,
  ).toHaveProperty("title", "Local unsent");
});
it("refuses foreign records, epoch recovery and unsupported collections before reading or advancing cursor", async () => {
  const f = fixture();
  for (const page of [
    { ...f.page, epoch: "new" },
    { ...f.page, recovery: true },
    { ...f.page, records: [{ ...f.page.records[0], workspaceId: "foreign" }] },
    { ...f.page, records: [{ ...f.page.records[0], collection: "notes" }] },
    {
      ...f.page,
      changes: {
        collections: { library: { upserts: [], removed: [] } },
        values: {},
      },
    },
    {
      ...f.page,
      changes: { ...f.page.changes, values: { calendarTimezone: "UTC" } },
    },
  ])
    await expect(
      prepareLocalWorkPull(actor, f.binding, page, [], f.metadata),
    ).rejects.toThrow();
  expect(f.metadata.getMany).not.toHaveBeenCalled();
  expect(f.metadata.commit).not.toHaveBeenCalled();
});
it("never overwrites an untracked local ID collision", async () => {
  const f = fixture();
  f.put({
    workspaceId: "local",
    collection: "items",
    id: "task",
    version: 1,
    value: localDto({
      ...f.canonical,
      workspaceId: "local",
      title: "Local original",
    }),
  });
  await expect(
    prepareLocalWorkPull(actor, f.binding, f.page, [], f.metadata),
  ).rejects.toThrow("VERSION_CONFLICT");
  expect(f.metadata.commit).not.toHaveBeenCalled();
});
it("represents deletion as a scoped tombstone and retains higher acknowledged deletion version", async () => {
  const f = fixture();
  f.put({
    workspaceId: "local",
    collection: "$local.remoteBase",
    id: JSON.stringify(["items", "task"]),
    version: 3,
    value: {
      remoteWorkspaceId: "remote",
      remotePrincipalId: "remote-owner",
      serverOrigin: f.binding.serverOrigin,
      epoch: "epoch",
      collection: "items",
      id: "task",
      version: 2,
      value: null,
    },
  });
  const page = {
    ...f.page,
    records: [{ ...f.page.records[0]!, op: "DELETE", version: 1 }],
    changes: {
      collections: { items: { upserts: [], removed: ["task"] } },
      values: {},
    },
  };
  const prepared = await prepareLocalWorkPull(
    actor,
    f.binding,
    page,
    [],
    f.metadata,
  );
  if (!prepared) throw new Error("EXPECTED_WORK_DELTA");
  expect(prepared.records[0]).toMatchObject({
    expectedVersion: 3,
    entity: { version: 4, value: { version: 2, value: null } },
  });
  expect(prepared.records[1]?.entity.value).toEqual({
    id: "task",
    workspaceId: "local",
    version: 2,
    localTombstone: true,
  });
});
