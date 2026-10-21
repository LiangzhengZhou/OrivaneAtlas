import type {
  LocalMutation,
  LocalOutboxTransition,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

const own = {
  schemaVersion: 1 as const,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
};
const binding = {
  workspaceId: own.workspaceId,
  remoteWorkspaceId: "remote",
  serverOrigin: "https://example.test",
  epoch: "epoch",
  cursor: 10,
  version: 1,
};
const inputs: LocalOutboxTransition[] = ["command", "effect"].map(
  (mutationId) => ({
    workspaceId: own.workspaceId,
    mutationId,
    binding,
    expectedState: "PENDING",
    expectedAttemptCount: 0,
    expectedLastAttemptAt: null,
    nextState: "SENDING",
    at: "2026-10-13T00:01:00Z",
  }),
);
async function fixture() {
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("group-claim", factory);
  const mutations: LocalMutation[] = inputs.map((input, index) => ({
    id: input.mutationId,
    commandId: "command",
    workspaceId: own.workspaceId,
    principalId: own.principalId,
    deviceId: own.deviceId,
    entityType: "items",
    entityId: index === 0 ? "project" : "task",
    operation: "PATCH",
    baseVersion: 1,
    payload: { title: "Original" },
    createdAt: "2026-10-13T00:00:00Z",
    attemptCount: 0,
    lastAttemptAt: null,
    state: "PENDING",
    order: { transactionVersion: 1, operationIndex: index },
  }));
  await store.metadata.restoreEmptyWorkspace!(
    {
      schemaVersion: 2,
      identity: own,
      syncState: binding,
      mutations,
      entities: [
        {
          workspaceId: own.workspaceId,
          collection: "$local.command",
          id: "command",
          version: 1,
          value: {
            schemaVersion: 1,
            id: "command",
            workspaceId: own.workspaceId,
            principalId: own.principalId,
            name: "work.update",
            input: {
              id: "project",
              version: 1,
              input: { completionResolution: { action: "INBOX" } },
            },
            mutationIds: ["command", "effect"],
          },
        },
      ],
    },
    own.deviceId,
  );
  return { store, factory };
}

it("cannot claim a command using another remote identity or stale binding version", async () => {
  const { store } = await fixture();
  try {
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    for (const changed of [
      { remotePrincipalId: "another-account" },
      { version: 2 },
    ]) {
      await expect(
        store.outbox.transitionMany(
          inputs.map((input) => ({
            ...input,
            binding: { ...binding, ...changed },
          })),
        ),
      ).rejects.toThrow();
      expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
        before,
      );
    }
  } finally {
    store.close();
  }
});

it("cannot claim part of a command and any stale effect rolls back the complete batch", async () => {
  const { store } = await fixture();
  try {
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    await expect(store.outbox.transition(inputs[0]!)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
    await expect(
      store.outbox.transitionMany([
        inputs[0]!,
        { ...inputs[1]!, expectedAttemptCount: 1 },
      ]),
    ).rejects.toThrow("VERSION_CONFLICT");
    await expect(
      store.outbox.transitionMany([inputs[0]!, inputs[0]!]),
    ).rejects.toThrow("INVALID_WRITE");
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
  } finally {
    store.close();
  }
});

it("allows one competing sender and preserves exact durable attempts after reopen", async () => {
  const { store, factory } = await fixture();
  try {
    const results = await Promise.allSettled([
      store.outbox.transitionMany(inputs),
      store.outbox.transitionMany(inputs),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const sending = await store.outbox.list(own.workspaceId);
    expect(
      sending.map((entry) => [
        entry.id,
        entry.state,
        entry.attemptCount,
        entry.lastAttemptAt,
      ]),
    ).toEqual([
      ["command", "SENDING", 1, "2026-10-13T00:01:00Z"],
      ["effect", "SENDING", 1, "2026-10-13T00:01:00Z"],
    ]);
    store.close();
    const reopened = await IndexedDbLocalStore.open("group-claim", factory);
    try {
      expect(await reopened.outbox.list(own.workspaceId)).toEqual(sending);
    } finally {
      reopened.close();
    }
  } finally {
    store.close();
  }
});

it("detaches the batch before callbacks and reset preserves original command and payload", async () => {
  const { store } = await fixture();
  try {
    const mutable = structuredClone(inputs);
    const send = store.outbox.transitionMany(mutable);
    Object.assign(mutable[1]!.binding, { version: 99 });
    await send;
    const before = await store.outbox.list(own.workspaceId);
    await store.outbox.transitionMany(
      inputs.map((input) => ({
        ...input,
        expectedState: "SENDING",
        expectedAttemptCount: 1,
        expectedLastAttemptAt: input.at,
        nextState: "PENDING",
        at: "2026-10-13T00:02:00Z",
      })),
    );
    const pending = await store.outbox.list(own.workspaceId);
    expect(pending).toEqual(
      before.map((entry) => ({ ...entry, state: "PENDING" })),
    );
  } finally {
    store.close();
  }
});
