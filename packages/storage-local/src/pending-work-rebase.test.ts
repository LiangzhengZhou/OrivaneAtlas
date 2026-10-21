import {
  type LocalMutation,
  type LocalSyncState,
  localDto,
  planLocalCommands,
  prepareLocalPendingWorkRebase,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { work } from "../../../tests/fixtures";
import { IndexedDbLocalStore } from "./indexed-db";

const own = {
  schemaVersion: 1 as const,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
};
const actor = { workspaceId: own.workspaceId, principalId: own.principalId };
const oldId = "44444444-4444-4444-8444-444444444444";
const nextId = "55555555-5555-4555-8555-555555555555";
const binding: LocalSyncState = {
  workspaceId: own.workspaceId,
  remoteWorkspaceId: "remote",
  remotePrincipalId: "remote-owner",
  serverOrigin: "https://example.test",
  epoch: "epoch",
  cursor: 10,
  version: 1,
};
const at = "2026-10-15T00:00:00.000Z";
async function fixture(sameField = false, attempted = false) {
  const base = localDto(work("task", own.workspaceId));
  const payload = localDto({
    ...work("task", own.workspaceId),
    title: "Local title",
    version: 2,
  });
  const canonical = localDto({
    ...work("task", "remote"),
    ...(sameField ? { title: "Remote title" } : { priority: "HIGH" }),
    version: 2,
  });
  const mutation: LocalMutation = {
    id: oldId,
    commandId: oldId,
    workspaceId: own.workspaceId,
    principalId: own.principalId,
    deviceId: own.deviceId,
    entityType: "items",
    entityId: "task",
    operation: "PATCH",
    baseVersion: 1,
    basePayload: base,
    payload,
    createdAt: at,
    attemptCount: attempted ? 1 : 0,
    lastAttemptAt: attempted ? at : null,
    state: "PENDING",
    order: { transactionVersion: 1, operationIndex: 0 },
  };
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("rebase", factory);
  await store.metadata.restoreEmptyWorkspace!(
    {
      schemaVersion: 2,
      identity: own,
      syncState: binding,
      mutations: [mutation],
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
          collection: "items",
          id: "task",
          version: 2,
          value: payload,
        },
        {
          workspaceId: own.workspaceId,
          collection: "$local.command",
          id: oldId,
          version: 1,
          value: {
            schemaVersion: 1,
            id: oldId,
            workspaceId: own.workspaceId,
            principalId: own.principalId,
            name: "work.update",
            input: {
              id: "task",
              version: 1,
              input: {
                title: "Local title",
                status: "TODO",
                executionMode: "MANUAL",
              },
            },
            mutationIds: [oldId],
          },
        },
        {
          workspaceId: own.workspaceId,
          collection: "$local.remoteBase",
          id: JSON.stringify(["items", "task"]),
          version: 1,
          value: {
            ...binding,
            collection: "items",
            id: "task",
            version: 2,
            value: canonical,
          },
        },
      ],
    },
    own.deviceId,
  );
  const prepare = async () => {
    const plans = await planLocalCommands(actor, store.metadata, [mutation]);
    return prepareLocalPendingWorkRebase(
      actor,
      binding,
      plans[0]!,
      [mutation],
      store.metadata,
      { next: () => nextId },
      { now: () => at },
    );
  };
  return { store, prepare, factory };
}
it("atomically rebases disjoint Work fields and retains original command and superseded intent across reopen", async () => {
  const { store, prepare } = await fixture();
  try {
    const original = await store.metadata.get(
      own.workspaceId,
      "$local.command",
      oldId,
    );
    const prepared = await prepare();
    expect(prepared).not.toBeNull();
    await store.pendingWorkRebase.commit(prepared!);
    expect(
      await store.metadata.get(own.workspaceId, "items", "task"),
    ).toMatchObject({
      version: 3,
      value: {
        title: "Local title",
        priority: "HIGH",
        workspaceId: own.workspaceId,
      },
    });
    expect(
      await store.metadata.get(own.workspaceId, "$local.command", oldId),
    ).toEqual(original);
    expect(
      await store.metadata.get(own.workspaceId, "$local.superseded", oldId),
    ).toMatchObject({
      value: {
        replacementId: nextId,
        reason: "CLEAN_REBASE",
        original: { id: oldId, baseVersion: 1 },
      },
    });
    const archive = await store.metadata.exportWorkspace!(own.workspaceId);
    expect(archive.mutations).toHaveLength(1);
    expect(archive.mutations[0]).toMatchObject({
      id: nextId,
      commandId: nextId,
      baseVersion: 2,
      attemptCount: 0,
      payload: { title: "Local title", priority: "HIGH" },
    });
    expect(
      (await planLocalCommands(actor, store.metadata, archive.mutations))[0],
    ).toMatchObject({
      state: "READY",
      command: { input: { version: 2, input: { title: "Local title" } } },
    });
    await expect(store.pendingWorkRebase.commit(prepared!)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      archive,
    );
  } finally {
    store.close();
  }
});
it.each([
  [true, false],
  [false, true],
])(
  "preserves same-field conflict or prior transmission unchanged (%s, %s)",
  async (same, sent) => {
    const { store, prepare } = await fixture(same, sent);
    try {
      const before = await store.metadata.exportWorkspace!(own.workspaceId);
      expect(await prepare()).toBeNull();
      expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
        before,
      );
    } finally {
      store.close();
    }
  },
);
it("rejects changed binding without partially replacing local data or original Outbox", async () => {
  const { store, prepare } = await fixture();
  try {
    const prepared = await prepare();
    expect(prepared).not.toBeNull();
    prepared!.binding = { ...prepared!.binding, epoch: "foreign-epoch" };
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    await expect(store.pendingWorkRebase.commit(prepared!)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
    expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
  } finally {
    store.close();
  }
});
it("coordinator pushes the replacement intent only after canonical pull, preserving original evidence on transport failure", async () => {
  const { store } = await fixture();
  try {
    const { LocalWorkSyncCoordinator } = await import(
      "@arclattice/application"
    );
    const sent: unknown[] = [];
    const coordinator = new LocalWorkSyncCoordinator(actor, {
      metadata: store.metadata,
      outbox: store.outbox,
      syncState: store.syncState,
      replica: store.replica,
      pendingRebase: {
        store: store.pendingWorkRebase,
        ids: { next: () => nextId },
      },
      clock: { now: () => at },
      transport: {
        pull: async () => ({
          epoch: "epoch",
          cursor: 10,
          recovery: false,
          hasMore: false,
          snapshot: null,
          records: [],
          changes: { collections: {}, values: {} },
        }),
        lookup: async () => null,
        send: async (_binding, request) => {
          sent.push(request);
          throw new Error("NETWORK_INTERRUPTED");
        },
      },
    });
    await expect(coordinator.run()).rejects.toThrow("NETWORK_INTERRUPTED");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      idempotencyKey: nextId,
      path: "/api/v1/work/update",
      body: { version: 2, input: { title: "Local title" } },
    });
    expect(
      await store.metadata.get(own.workspaceId, "$local.superseded", oldId),
    ).not.toBeNull();
    expect(
      (await store.metadata.exportWorkspace!(own.workspaceId)).mutations,
    ).toMatchObject([{ id: nextId, attemptCount: 1, state: "SENDING" }]);
  } finally {
    store.close();
  }
});

it("replacement and original evidence survive database reopen without regenerating an idempotency key", async () => {
  const { store, prepare, factory } = await fixture();
  const prepared = await prepare();
  expect(prepared).not.toBeNull();
  await store.pendingWorkRebase.commit(prepared!);
  const before = await store.metadata.exportWorkspace!(own.workspaceId);
  store.close();
  const reopened = await IndexedDbLocalStore.open("rebase", factory);
  try {
    expect(await reopened.metadata.exportWorkspace!(own.workspaceId)).toEqual(
      before,
    );
    expect(
      (await planLocalCommands(actor, reopened.metadata, before.mutations))[0],
    ).toMatchObject({ id: nextId, state: "READY" });
  } finally {
    reopened.close();
  }
});
it.each(["LOCAL", "REMOTE"] as const)(
  "explicit %s conflict choice uses fresh canonical version and preserves original transmitted conflict",
  async (choice) => {
    const { store } = await fixture(true);
    try {
      await store.outbox.transition({
        workspaceId: own.workspaceId,
        mutationId: oldId,
        binding: {
          ...binding,
          remoteWorkspaceId: "remote",
          serverOrigin: "https://example.test",
        },
        expectedState: "PENDING",
        expectedAttemptCount: 0,
        expectedLastAttemptAt: null,
        nextState: "SENDING",
        at,
      });
      await store.outbox.transition({
        workspaceId: own.workspaceId,
        mutationId: oldId,
        binding: {
          ...binding,
          remoteWorkspaceId: "remote",
          serverOrigin: "https://example.test",
        },
        expectedState: "SENDING",
        expectedAttemptCount: 1,
        expectedLastAttemptAt: at,
        nextState: "CONFLICT",
        at,
      });
      const { listLocalWorkConflictReviews } = await import(
        "@arclattice/application"
      );
      const captured = (
        await listLocalWorkConflictReviews(
          actor,
          binding,
          store.metadata,
          store.outbox,
        )
      )[0]!;
      const pending = await store.outbox.list(own.workspaceId);
      const plan = (
        await planLocalCommands(actor, store.metadata, pending)
      )[0]!;
      const stale = structuredClone(captured);
      stale.expectedWorkspaceVersion = 999;
      const before = await store.metadata.exportWorkspace!(own.workspaceId);
      await expect(
        prepareLocalPendingWorkRebase(
          actor,
          binding,
          plan,
          pending,
          store.metadata,
          { next: () => nextId },
          { now: () => at },
          { captured: stale, choice },
        ),
      ).rejects.toThrow("VERSION_CONFLICT");
      expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
        before,
      );
      const prepared = await prepareLocalPendingWorkRebase(
        actor,
        binding,
        plan,
        pending,
        store.metadata,
        { next: () => nextId },
        { now: () => at },
        { captured, choice },
      );
      expect(prepared).not.toBeNull();
      await store.pendingWorkRebase.commit(prepared!);
      expect(
        await store.metadata.get(own.workspaceId, "items", "task"),
      ).toMatchObject({
        version: 3,
        value: { title: choice === "LOCAL" ? "Local title" : "Remote title" },
      });
      expect(
        await store.metadata.get(own.workspaceId, "$local.superseded", oldId),
      ).toMatchObject({
        value: {
          reason: `REVIEWED_${choice}`,
          original: { state: "CONFLICT", attemptCount: 1 },
        },
      });
      expect((await store.outbox.list(own.workspaceId))[0]).toMatchObject({
        id: nextId,
        state: "PENDING",
        attemptCount: 0,
        baseVersion: 2,
      });
    } finally {
      store.close();
    }
  },
);

async function fileFixture(reviewed = false) {
  const f = await fixture();
  const archive = await f.store.metadata.exportWorkspace!(own.workspaceId);
  f.store.close();
  const base = {
    id: "task",
    workspaceId: own.workspaceId,
    spaceId: null,
    parentDocumentId: null,
    name: "original.txt",
    originalName: "original.txt",
    extension: "txt",
    mime: "text/plain",
    size: 8,
    contentHash: "a".repeat(64),
    blobId: "a".repeat(64),
    version: 1,
    provenance: "HUMAN",
    aiPolicy: {
      classification: "PRIVATE",
      processingBoundary: "ANY",
      aiAccess: "ASK",
    },
    extractionStatus: "READY",
    indexStatus: "READY",
    createdBy: own.principalId,
    updatedBy: own.principalId,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  const payload = localDto({ ...base, name: "device-name.txt", version: 2 });
  const canonical = localDto({
    ...base,
    workspaceId: "remote",
    version: 2,
    ...(reviewed
      ? { name: "remote-name.txt" }
      : { aiPolicy: { ...base.aiPolicy, aiAccess: "DENY" } }),
  });
  const mutation: LocalMutation = {
    ...archive.mutations[0]!,
    entityType: "files",
    basePayload: localDto(base),
    payload,
    state: reviewed ? "CONFLICT" : "PENDING",
    attemptCount: reviewed ? 1 : 0,
    lastAttemptAt: reviewed ? at : null,
  };
  const store = await IndexedDbLocalStore.open("file-rebase", f.factory);
  await store.metadata.restoreEmptyWorkspace!(
    {
      ...archive,
      mutations: [mutation],
      entities: archive.entities.map((record) => {
        if (record.collection === "items")
          return { ...record, collection: "files", value: payload };
        if (record.collection === "$local.command")
          return {
            ...record,
            value: {
              ...(record.value as object),
              name: "file.rename",
              input: { id: "task", version: 1, name: "device-name.txt" },
            },
          };
        if (record.collection === "$local.remoteBase")
          return {
            ...record,
            id: JSON.stringify(["files", "task"]),
            value: {
              ...binding,
              collection: "files",
              id: "task",
              version: 2,
              value: canonical,
            },
          };
        return record;
      }),
    },
    own.deviceId,
  );
  return { store, mutation, canonical, base };
}
it("File rename rebase retains immutable original identity and a concurrent remote policy", async () => {
  const { store, mutation } = await fileFixture();
  try {
    const plans = await planLocalCommands(actor, store.metadata, [mutation]);
    const prepared = await prepareLocalPendingWorkRebase(
      actor,
      binding,
      plans[0]!,
      [mutation],
      store.metadata,
      { next: () => nextId },
      { now: () => at },
    );
    expect(prepared).not.toBeNull();
    await store.pendingWorkRebase.commit(prepared!);
    expect(
      await store.metadata.get(own.workspaceId, "files", "task"),
    ).toMatchObject({
      version: 3,
      value: {
        name: "device-name.txt",
        originalName: "original.txt",
        contentHash: "a".repeat(64),
        aiPolicy: { aiAccess: "DENY" },
      },
    });
    expect(prepared!.replacementCommand.value).toMatchObject({
      name: "file.rename",
      input: { id: "task", version: 2, name: "device-name.txt" },
    });
    expect(
      await store.metadata.get(own.workspaceId, "$local.command", oldId),
    ).toMatchObject({
      value: { input: { version: 1, name: "device-name.txt" } },
    });
  } finally {
    store.close();
  }
});
for (const choice of ["LOCAL", "REMOTE"] as const)
  it(`File same-name conflict requires explicit ${choice} review and retains originals`, async () => {
    const { store, mutation } = await fileFixture(true);
    try {
      const { listLocalWorkConflictReviews } = await import(
        "@arclattice/application"
      );
      const reviews = await listLocalWorkConflictReviews(
        actor,
        binding,
        store.metadata,
        store.outbox,
      );
      expect(reviews).toHaveLength(1);
      const plans = await planLocalCommands(actor, store.metadata, [mutation]);
      const prepared = await prepareLocalPendingWorkRebase(
        actor,
        binding,
        plans[0]!,
        [mutation],
        store.metadata,
        { next: () => nextId },
        { now: () => at },
        { captured: reviews[0]!, choice },
      );
      expect(prepared).not.toBeNull();
      await store.pendingWorkRebase.commit(prepared!);
      expect(
        await store.metadata.get(own.workspaceId, "files", "task"),
      ).toMatchObject({
        version: 3,
        value: {
          name: choice === "LOCAL" ? "device-name.txt" : "remote-name.txt",
          contentHash: "a".repeat(64),
          originalName: "original.txt",
        },
      });
      expect(
        await store.metadata.get(own.workspaceId, "$local.command", oldId),
      ).not.toBeNull();
    } finally {
      store.close();
    }
  });

it.each(["LOCAL", "REMOTE"] as const)(
  "reviewed %s predecessor retains later unsent edits and their original causal order",
  async (choice) => {
    const originalStore = await fixture(true, true);
    const archive = await originalStore.store.metadata.exportWorkspace!(
      own.workspaceId,
    );
    originalStore.store.close();
    const original = { ...archive.mutations[0]!, state: "CONFLICT" as const };
    const followerId = "66666666-6666-4666-8666-666666666666";
    const latest = localDto({
      ...work("task", own.workspaceId),
      title: "Later device title",
      version: 3,
    });
    const follower: LocalMutation = {
      ...original,
      id: followerId,
      commandId: followerId,
      baseVersion: 2,
      basePayload: original.payload,
      payload: latest,
      state: "PENDING",
      attemptCount: 0,
      lastAttemptAt: null,
      order: { transactionVersion: 2, operationIndex: 0 },
    };
    const store = await IndexedDbLocalStore.open(
      "review-chain",
      new IDBFactory(),
    );
    try {
      await store.metadata.restoreEmptyWorkspace!(
        {
          ...archive,
          mutations: [original, follower],
          entities: [
            ...archive.entities.map((entity) =>
              entity.collection === "items"
                ? { ...entity, version: 3, value: latest }
                : entity,
            ),
            {
              workspaceId: own.workspaceId,
              collection: "$local.command",
              id: followerId,
              version: 1,
              value: {
                schemaVersion: 1,
                id: followerId,
                workspaceId: own.workspaceId,
                principalId: own.principalId,
                name: "work.update",
                mutationIds: [followerId],
                input: {
                  id: "task",
                  version: 2,
                  input: { title: "Later device title" },
                },
              },
            },
          ],
        },
        own.deviceId,
      );
      const { listLocalWorkConflictReviews } = await import(
        "@arclattice/application"
      );
      const captured = (
        await listLocalWorkConflictReviews(
          actor,
          binding,
          store.metadata,
          store.outbox,
        )
      )[0]!;
      expect(captured.followers).toEqual([follower]);
      const pending = await store.outbox.list(own.workspaceId);
      const first = (
        await planLocalCommands(actor, store.metadata, pending)
      )[0]!;
      const prepared = await prepareLocalPendingWorkRebase(
        actor,
        binding,
        first,
        pending,
        store.metadata,
        { next: () => nextId },
        { now: () => at },
        { captured, choice },
      );
      expect(prepared).not.toBeNull();
      const current = await store.metadata.get(
        own.workspaceId,
        "items",
        "task",
      );
      await store.pendingWorkRebase.commit(prepared!);
      expect(
        await store.metadata.get(own.workspaceId, "items", "task"),
      ).toEqual(current);
      const after = await store.outbox.list(own.workspaceId);
      expect(after.find((entry) => entry.id === followerId)).toEqual(follower);
      expect(after.find((entry) => entry.id === nextId)).toMatchObject({
        order: original.order,
        payload: { title: choice === "LOCAL" ? "Local title" : "Remote title" },
      });
      expect(
        (await planLocalCommands(actor, store.metadata, after)).map(
          (plan) => plan.id,
        ),
      ).toEqual([nextId, followerId]);
      expect(
        await store.metadata.get(own.workspaceId, "$local.command", oldId),
      ).not.toBeNull();
    } finally {
      store.close();
    }
  },
);
