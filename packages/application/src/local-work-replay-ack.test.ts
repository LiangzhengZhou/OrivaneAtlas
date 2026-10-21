import { expect, it, vi } from "vitest";
import { work } from "../../../tests/fixtures";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto } from "./local-dto";
import type {
  LocalEntity,
  LocalMetadataStore,
  LocalMutation,
  LocalSyncState,
} from "./local-persistence";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  taskId = "33333333-3333-4333-8333-333333333333";
const actor = { workspaceId: "local", principalId: "owner" };
function fixture(later = false) {
  const binding: LocalSyncState = {
    workspaceId: actor.workspaceId,
    remoteWorkspaceId: "remote",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 10,
    version: 1,
  };
  const mutation: LocalMutation = {
    id: commandId,
    commandId,
    deviceId,
    workspaceId: actor.workspaceId,
    principalId: actor.principalId,
    entityType: "items",
    entityId: taskId,
    operation: "PATCH",
    baseVersion: 1,
    payload: { title: "Accepted" },
    createdAt: "2026-10-13T00:00:00Z",
    state: "SENDING",
    attemptCount: 1,
    lastAttemptAt: "2026-10-13T00:01:00Z",
  };
  const plan: LocalCommandPlan = {
    id: commandId,
    state: "RECEIPT_REQUIRED",
    command: {
      name: "work.update",
      input: { id: taskId, version: 1, input: { title: "Accepted" } },
    },
    mutationIds: [commandId],
    mutations: [mutation],
  };
  const canonical = {
    ...work(taskId, "remote"),
    title: "Accepted",
    version: 2,
  };
  const receipt = {
    commandId,
    deviceId,
    result: canonical,
    effects: [
      {
        collection: "items",
        id: taskId,
        op: "UPSERT",
        version: 2,
        value: canonical,
      },
    ],
  };
  const records = new Map<string, LocalEntity>();
  const put = (entity: LocalEntity) =>
    records.set(JSON.stringify([entity.collection, entity.id]), entity);
  put({
    workspaceId: actor.workspaceId,
    collection: "$local.workspace",
    id: "revision",
    version: 10,
    value: { revision: 10 },
  });
  put({
    workspaceId: actor.workspaceId,
    collection: "items",
    id: taskId,
    version: later ? 3 : 2,
    value: localDto({
      ...canonical,
      workspaceId: actor.workspaceId,
      version: later ? 3 : 2,
      title: later ? "Later local edit" : "Accepted",
    }),
  });
  const metadata: LocalMetadataStore = {
    get: vi.fn(async (_workspaceId, collection, id) =>
      structuredClone(records.get(JSON.stringify([collection, id])) ?? null),
    ),
    list: vi.fn(async () => []),
    commit: vi.fn(async () => {}),
  };
  const pending: LocalMutation[] = [
    mutation,
    ...(later
      ? [
          {
            ...mutation,
            id: "later",
            commandId: "later",
            state: "PENDING" as const,
            attemptCount: 0,
            lastAttemptAt: null,
            baseVersion: 2,
            payload: { title: "Later local edit" },
          },
        ]
      : []),
  ];
  return {
    binding,
    mutation,
    plan,
    canonical,
    receipt,
    metadata,
    pending,
    put,
  };
}

it("prepares exact grouped ACK/canonical base with unchanged cursor and no user writes", async () => {
  const f = fixture();
  const prepared = await prepareLocalWorkReplayAcknowledgement(
    actor,
    f.binding,
    f.plan,
    f.receipt,
    f.pending,
    f.metadata,
  );
  expect(prepared).toMatchObject({
    workspaceId: actor.workspaceId,
    principalId: actor.principalId,
    expectedWorkspaceVersion: 10,
    nextCursor: 10,
    acknowledgements: [
      {
        mutationId: commandId,
        deviceId,
        attemptCount: 1,
        lastAttemptAt: f.mutation.lastAttemptAt,
      },
    ],
  });
  expect(prepared.records).toHaveLength(2);
  expect(prepared.records[0]).toMatchObject({
    expectedVersion: null,
    entity: {
      collection: "$local.remoteBase",
      version: 1,
      value: {
        remoteWorkspaceId: "remote",
        serverOrigin: f.binding.serverOrigin,
        epoch: "epoch",
        version: 2,
        mutationIds: [commandId],
        value: f.canonical,
      },
    },
  });
  expect(prepared.records[1]).toMatchObject({
    expectedVersion: 2,
    entity: {
      collection: "items",
      version: 2,
      value: {
        id: taskId,
        workspaceId: actor.workspaceId,
        version: 2,
        title: "Accepted",
      },
    },
  });
  expect(f.metadata.commit).not.toHaveBeenCalled();
  expect(f.metadata.list).not.toHaveBeenCalled();
});

it("retains later local edits and newer canonical bases instead of overwriting them with old receipts", async () => {
  const f = fixture(true);
  const prepared = await prepareLocalWorkReplayAcknowledgement(
    actor,
    f.binding,
    f.plan,
    f.receipt,
    f.pending,
    f.metadata,
  );
  expect(prepared.records).toHaveLength(1);
  expect(prepared.records[0]?.entity.collection).toBe("$local.remoteBase");
  const newer = { ...f.canonical, title: "Newer remote value", version: 4 };
  f.put({
    workspaceId: actor.workspaceId,
    collection: "$local.remoteBase",
    id: JSON.stringify(["items", taskId]),
    version: 5,
    value: localDto({
      remoteWorkspaceId: "remote",
      serverOrigin: f.binding.serverOrigin,
      epoch: "epoch",
      collection: "items",
      id: taskId,
      version: 4,
      value: newer,
    }),
  });
  const newerPrepared = await prepareLocalWorkReplayAcknowledgement(
    actor,
    f.binding,
    f.plan,
    f.receipt,
    f.pending,
    f.metadata,
  );
  expect(newerPrepared.records).toHaveLength(1);
  expect(newerPrepared.records[0]).toMatchObject({
    expectedVersion: 5,
    entity: {
      version: 6,
      value: { version: 4, value: newer, mutationIds: [commandId] },
    },
  });
});

it("rejects foreign, partial, stale, malformed and unsent receipt data before any write", async () => {
  const f = fixture();
  for (const receipt of [
    { ...f.receipt, commandId: "foreign" },
    { ...f.receipt, deviceId: "foreign" },
    { ...f.receipt, effects: [] },
    { ...f.receipt, effects: [...f.receipt.effects, ...f.receipt.effects] },
    { ...f.receipt, effects: [{ ...f.receipt.effects[0], version: 1 }] },
    {
      ...f.receipt,
      effects: [
        {
          ...f.receipt.effects[0],
          value: { ...f.canonical, workspaceId: "foreign" },
        },
      ],
    },
    {
      ...f.receipt,
      effects: [
        {
          ...f.receipt.effects[0],
          value: { ...f.canonical, status: "INVALID" },
        },
      ],
    },
    {
      ...f.receipt,
      effects: [
        {
          ...f.receipt.effects[0],
          value: { ...f.canonical, dueDate: "2026-02-30" },
        },
      ],
    },
  ])
    await expect(
      prepareLocalWorkReplayAcknowledgement(
        actor,
        f.binding,
        f.plan,
        receipt,
        f.pending,
        f.metadata,
      ),
    ).rejects.toThrow("VALIDATION_ERROR");
  await expect(
    prepareLocalWorkReplayAcknowledgement(
      actor,
      f.binding,
      { ...f.plan, mutations: [{ ...f.mutation, state: "PENDING" }] },
      f.receipt,
      f.pending,
      f.metadata,
    ),
  ).rejects.toThrow("VALIDATION_ERROR");
  expect(f.metadata.commit).not.toHaveBeenCalled();
});

it("captures the actor, binding, original attempt and canonical content before asynchronous reads", async () => {
  const f = fixture(),
    mutableActor = { ...actor };
  const promise = prepareLocalWorkReplayAcknowledgement(
    mutableActor,
    f.binding,
    f.plan,
    f.receipt,
    f.pending,
    f.metadata,
  );
  mutableActor.principalId = "foreign";
  Object.assign(f.binding, { cursor: 99 });
  f.receipt.effects[0]!.value.title = "Mutated";
  const prepared = await promise;
  expect(prepared.principalId).toBe(actor.principalId);
  expect(prepared.nextCursor).toBe(10);
  expect(prepared.records[0]?.entity.value).toMatchObject({
    value: { title: "Accepted" },
  });
});
