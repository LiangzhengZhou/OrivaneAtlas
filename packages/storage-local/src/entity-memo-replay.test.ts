import {
  LocalRuntime,
  type LocalSyncState,
  LocalWorkspace,
  listLocalWorkConflictReviews,
  localDto,
  localEntityMemoBootstrapCursor,
  localObject,
  planLocalCommands,
  prepareLocalEntityMemoBootstrap,
  prepareLocalPendingWorkRebase,
  prepareLocalPurgedMemo,
  prepareLocalWorkPull,
  prepareLocalWorkReplayAcknowledgement,
} from "@arclattice/application";
import type { EntityMemo } from "@arclattice/domain";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import { work } from "../../../tests/fixtures";
import { deriveEntityMemoId } from "./entity-memo-identity";
import { IndexedDbLocalStore } from "./indexed-db";

function bound(value: LocalSyncState | null) {
  if (!value?.remoteWorkspaceId || !value.serverOrigin)
    throw new Error("MISSING_TEST_BINDING");
  return {
    ...value,
    remoteWorkspaceId: value.remoteWorkspaceId,
    serverOrigin: value.serverOrigin,
  };
}

test("private Memo ACK is atomic, owner-mapped, restart-safe and rejects forged attempts and bindings", async () => {
  const factory = new IDBFactory();
  const own = {
    schemaVersion: 1 as const,
    workspaceId: crypto.randomUUID(),
    principalId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
  };
  const binding = {
    workspaceId: own.workspaceId,
    remoteWorkspaceId: crypto.randomUUID(),
    remotePrincipalId: crypto.randomUUID(),
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 0,
    version: 1,
  };
  const identity = {
    forTarget: deriveEntityMemoId,
    nextChangeId: () => crypto.randomUUID(),
  };
  let store = await IndexedDbLocalStore.open("memo-ack", factory);
  const runtime = () =>
    new LocalRuntime(
      new LocalWorkspace(
        store.metadata,
        {
          get: async () => null,
          put: async () => {
            throw new Error("UNEXPECTED_BINARY_WRITE");
          },
        },
        own,
        { extract: () => [], resolve: () => [] },
        { now: () => "2026-10-16T00:00:00.000Z" },
        { next: () => crypto.randomUUID() },
      ),
      identity,
    );
  try {
    await store.identity.ensure(own);
    const local = runtime();
    const task = await local.service.create(local.context, {
      type: "TASK",
      title: "Private target",
    });
    const target = {
      targetKind: "TASK" as const,
      targetId: task.id,
      bodyMd: "original\n私人正文\n",
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "ANY",
        aiAccess: "ASK",
      } as const,
    };
    const memo = (await local.saveEntityMemo(target, 0))!;
    await store.syncState.save(binding, null);
    let pending = await store.outbox.list(own.workspaceId);
    const plan = (
      await planLocalCommands(local.context, store.metadata, pending)
    ).find((p) => p.command?.name === "memo.save")!;
    const mutations = await store.outbox.transitionMany(
      plan.mutations.map((m) => ({
        workspaceId: own.workspaceId,
        mutationId: m.id,
        binding,
        expectedState: "PENDING" as const,
        expectedAttemptCount: 0,
        expectedLastAttemptAt: null,
        nextState: "SENDING" as const,
        at: "2026-10-16T00:01:00.000Z",
      })),
    );
    const sending = { ...plan, state: "RECEIPT_REQUIRED" as const, mutations };
    const remote = {
      ...memo,
      workspaceId: binding.remoteWorkspaceId,
      ownerPrincipalId: binding.remotePrincipalId,
      createdBy: binding.remotePrincipalId,
      updatedBy: binding.remotePrincipalId,
      id: await deriveEntityMemoId(
        {
          workspaceId: binding.remoteWorkspaceId,
          principalId: binding.remotePrincipalId,
        },
        target,
      ),
    };
    const receipt = {
      commandId: plan.id,
      deviceId: own.deviceId,
      result: remote,
      effects: [
        {
          collection: "entityMemos",
          id: remote.id,
          op: "UPSERT",
          version: 1,
          value: remote,
        },
      ],
    };
    pending = await store.outbox.list(own.workspaceId);
    const commit = await prepareLocalWorkReplayAcknowledgement(
      local.context,
      binding,
      sending,
      receipt,
      pending,
      store.metadata,
      undefined,
      identity,
    );
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    for (const alter of ["owner", "remoteId", "attempt", "binding"] as const) {
      const detached = structuredClone(commit);
      const forged = {
        ...detached,
        records: detached.records.map((record) => ({
          ...record,
          entity: { ...record.entity },
        })),
        acknowledgements: detached.acknowledgements!.map((ack) => ({ ...ack })),
      };
      if (alter === "owner")
        forged.records[1]!.entity.value = localDto({
          ...memo,
          ownerPrincipalId: "another",
        });
      if (alter === "remoteId")
        forged.records[0]!.entity.value = localDto({
          ...(forged.records[0]!.entity.value as object),
          remoteId: crypto.randomUUID(),
        });
      if (alter === "attempt") forged.acknowledgements![0]!.attemptCount++;
      if (alter === "binding")
        forged.binding = { ...binding, remotePrincipalId: crypto.randomUUID() };
      await expect(store.replica.commit(forged)).rejects.toThrow(
        alter === "attempt" ? "VERSION_CONFLICT" : "INVALID_WRITE",
      );
      expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
        before,
      );
      expect(await store.outbox.list(own.workspaceId)).toEqual(pending);
      expect(await store.syncState.get(own.workspaceId)).toEqual(binding);
    }
    await store.replica.commit(commit);
    expect(
      (await store.outbox.list(own.workspaceId)).filter(
        (m) => m.entityType === "entityMemos",
      ),
    ).toEqual([]);
    expect(await runtime().getEntityMemo(target)).toEqual(memo);
    store.close();
    store = await IndexedDbLocalStore.open("memo-ack", factory);
    expect(await runtime().getEntityMemo(target)).toEqual(memo);
    expect(
      await store.metadata.get(
        own.workspaceId,
        "$local.remoteBase",
        JSON.stringify(["entityMemos", memo.id]),
      ),
    ).toMatchObject({ value: { remoteId: remote.id, value: remote } });
    await expect(store.replica.commit(commit)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
  } finally {
    store.close();
  }
});

test("concurrent first Memo creation requires explicit review and keeps the original create evidence", async () => {
  for (const choice of ["LOCAL", "REMOTE"] as const) {
    const own = {
      schemaVersion: 1 as const,
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
    };
    const actor = {
      workspaceId: own.workspaceId,
      principalId: own.principalId,
    };
    const binding = {
      workspaceId: own.workspaceId,
      remoteWorkspaceId: crypto.randomUUID(),
      remotePrincipalId: crypto.randomUUID(),
      serverOrigin: "https://example.test",
      epoch: "epoch",
      cursor: 0,
      version: 1,
    };
    const target = {
      targetKind: "TASK" as const,
      targetId: crypto.randomUUID(),
    };
    const identity = {
      forTarget: deriveEntityMemoId,
      nextChangeId: () => crypto.randomUUID(),
    };
    const store = await IndexedDbLocalStore.open(
      "memo-first-conflict-" + choice,
      new IDBFactory(),
    );
    try {
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
              collection: "items",
              id: target.targetId,
              version: 1,
              value: localDto(work(target.targetId, own.workspaceId)),
            },
          ],
          mutations: [],
        },
        own.deviceId,
      );
      const runtime = new LocalRuntime(
        new LocalWorkspace(
          store.metadata,
          {
            get: async () => null,
            put: async () => {
              throw new Error("UNEXPECTED_BINARY_WRITE");
            },
          },
          own,
          { extract: () => [], resolve: () => [] },
          { now: () => "2026-10-16T00:00:00Z" },
          { next: () => crypto.randomUUID() },
        ),
        identity,
      );
      const local = (await runtime.saveEntityMemo(
        { ...target, bodyMd: "local first draft" },
        0,
      ))!;
      const remote = {
        ...local,
        id: await deriveEntityMemoId(
          {
            workspaceId: binding.remoteWorkspaceId,
            principalId: binding.remotePrincipalId,
          },
          target,
        ),
        workspaceId: binding.remoteWorkspaceId,
        ownerPrincipalId: binding.remotePrincipalId,
        createdBy: binding.remotePrincipalId,
        updatedBy: binding.remotePrincipalId,
        bodyMd: "remote first draft",
      };
      const page = {
        epoch: binding.epoch,
        cursor: 1,
        recovery: false,
        hasMore: false,
        snapshot: null,
        records: [
          {
            seq: 1,
            workspaceId: binding.remoteWorkspaceId,
            collection: "entityMemos",
            entityId: remote.id,
            op: "UPSERT",
            version: 1,
          },
        ],
        changes: {
          values: {},
          collections: { entityMemos: { upserts: [remote], removed: [] } },
        },
      };
      await store.replica.commit(
        (await prepareLocalWorkPull(
          actor,
          binding,
          page,
          await store.outbox.list(own.workspaceId),
          store.metadata,
          identity,
        ))!,
      );
      const scope = bound(await store.syncState.get(own.workspaceId));
      const originalPlan = (
        await planLocalCommands(
          actor,
          store.metadata,
          await store.outbox.list(own.workspaceId),
        )
      )[0]!;
      expect(originalPlan.mutations[0]).toMatchObject({
        operation: "CREATE",
        baseVersion: null,
        basePayload: null,
      });
      expect(
        await prepareLocalPendingWorkRebase(
          actor,
          scope,
          originalPlan,
          await store.outbox.list(own.workspaceId),
          store.metadata,
          { next: () => crypto.randomUUID() },
          { now: () => "2026-10-16T01:00:00Z" },
          undefined,
          undefined,
          identity,
        ),
      ).toBeNull();
      const sending = await store.outbox.transition({
        workspaceId: own.workspaceId,
        mutationId: originalPlan.id,
        binding: scope,
        expectedState: "PENDING",
        expectedAttemptCount: 0,
        expectedLastAttemptAt: null,
        nextState: "SENDING",
        at: "2026-10-16T01:00:00Z",
      });
      await store.outbox.transition({
        workspaceId: own.workspaceId,
        mutationId: originalPlan.id,
        binding: scope,
        expectedState: "SENDING",
        expectedAttemptCount: sending.attemptCount,
        expectedLastAttemptAt: sending.lastAttemptAt,
        nextState: "CONFLICT",
        at: "2026-10-16T01:01:00Z",
      });
      const pending = await store.outbox.list(own.workspaceId);
      const plan = (
        await planLocalCommands(actor, store.metadata, pending)
      )[0]!;
      const captured = (
        await listLocalWorkConflictReviews(
          actor,
          scope,
          store.metadata,
          store.outbox,
        )
      )[0]!;
      expect(captured.original.operation).toBe("CREATE");
      const prepared = (await prepareLocalPendingWorkRebase(
        actor,
        scope,
        plan,
        pending,
        store.metadata,
        { next: () => crypto.randomUUID() },
        { now: () => "2026-10-16T02:00:00Z" },
        { captured, choice },
        undefined,
        identity,
      ))!;
      expect(prepared).not.toBeNull();
      await store.pendingWorkRebase.commit(prepared);
      expect(await runtime.getEntityMemo(target)).toMatchObject({
        id: local.id,
        bodyMd: choice === "LOCAL" ? local.bodyMd : remote.bodyMd,
        version: 2,
      });
      const next = await store.outbox.list(own.workspaceId);
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({
        operation: "PATCH",
        baseVersion: 1,
        state: "PENDING",
        payload: { version: 2, ownerPrincipalId: own.principalId },
      });
      expect(
        await store.metadata.get(own.workspaceId, "$local.superseded", plan.id),
      ).toMatchObject({
        value: { original: captured.original, replacementId: next[0]!.id },
      });
    } finally {
      store.close();
    }
  }
});

test("one-time private journal bootstrap recovers old Memo rows without skipping public changes and survives restart", async () => {
  const own = {
    schemaVersion: 1 as const,
    workspaceId: crypto.randomUUID(),
    principalId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
  };
  const scope = {
    workspaceId: own.workspaceId,
    remoteWorkspaceId: crypto.randomUUID(),
    remotePrincipalId: crypto.randomUUID(),
    serverOrigin: "https://example.test",
    epoch: "epoch",
    version: 1,
    cursor: 100,
  };
  const actor = { workspaceId: own.workspaceId, principalId: own.principalId };
  const remoteActor = {
    workspaceId: scope.remoteWorkspaceId,
    principalId: scope.remotePrincipalId,
  };
  const target = { targetKind: "TASK" as const, targetId: crypto.randomUUID() };
  const memo = {
    ...target,
    id: await deriveEntityMemoId(remoteActor, target),
    workspaceId: scope.remoteWorkspaceId,
    ownerPrincipalId: scope.remotePrincipalId,
    createdBy: scope.remotePrincipalId,
    updatedBy: scope.remotePrincipalId,
    bodyMd: "older than public cursor",
    version: 1,
    createdAt: "2026-10-16T00:00:00Z",
    updatedAt: "2026-10-16T00:00:00Z",
    deletedAt: null,
  };
  const page = {
    epoch: scope.epoch,
    cursor: 150,
    recovery: false,
    hasMore: false,
    snapshot: null,
    records: [
      {
        seq: 5,
        workspaceId: scope.remoteWorkspaceId,
        collection: "entityMemos",
        entityId: memo.id,
        op: "UPSERT",
        version: 1,
      },
    ],
    changes: {
      values: {},
      collections: { entityMemos: { upserts: [memo], removed: [] } },
    },
  };
  const factory = new IDBFactory();
  let store = await IndexedDbLocalStore.open("memo-bootstrap", factory);
  try {
    await store.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity: own,
        syncState: scope,
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
            id: target.targetId,
            version: 1,
            value: localDto(work(target.targetId, own.workspaceId)),
          },
        ],
        mutations: [],
      },
      own.deviceId,
    );
    expect(
      await localEntityMemoBootstrapCursor(actor, scope, store.metadata),
    ).toBe(0);
    const identity = { forTarget: deriveEntityMemoId };
    // Private-only history must reject an ordinary Note rather than accepting
    // a malformed transport page or marking the owner's bootstrap complete.
    await expect(
      prepareLocalEntityMemoBootstrap(
        actor,
        scope,
        {
          ...page,
          records: [],
          changes: {
            values: {},
            collections: { notes: { upserts: [], removed: [] } },
          },
        },
        [],
        store.metadata,
        identity,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await store.syncState.get(own.workspaceId)).toEqual(scope);
    expect(
      await localEntityMemoBootstrapCursor(actor, scope, store.metadata),
    ).toBe(0);
    await expect(
      prepareLocalEntityMemoBootstrap(
        actor,
        scope,
        { ...page, records: [{ ...page.records[0]!, collection: "items" }] },
        [],
        store.metadata,
        identity,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      prepareLocalEntityMemoBootstrap(
        actor,
        scope,
        { ...page, epoch: "changed" },
        [],
        store.metadata,
        identity,
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const commit = await prepareLocalEntityMemoBootstrap(
      actor,
      scope,
      page,
      [],
      store.metadata,
      identity,
    );
    expect(commit.nextCursor).toBe(100);
    await store.replica.commit(commit);
    const binding = (await store.syncState.get(own.workspaceId))!;
    expect(binding.cursor).toBe(100);
    expect(
      await localEntityMemoBootstrapCursor(actor, binding, store.metadata),
    ).toBeNull();
    const localId = await deriveEntityMemoId(actor, target);
    expect(
      await store.metadata.get(own.workspaceId, "entityMemos", localId),
    ).toMatchObject({
      value: { bodyMd: memo.bodyMd, ownerPrincipalId: own.principalId },
    });
    store.close();
    store = await IndexedDbLocalStore.open("memo-bootstrap", factory);
    expect(
      await localEntityMemoBootstrapCursor(actor, binding, store.metadata),
    ).toBeNull();
    for (const change of [
      { remotePrincipalId: crypto.randomUUID() },
      { remoteWorkspaceId: crypto.randomUUID() },
      { epoch: "different" },
      { serverOrigin: "https://another.test" },
    ])
      await expect(
        localEntityMemoBootstrapCursor(
          actor,
          { ...binding, ...change },
          store.metadata,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await store.outbox.list(own.workspaceId)).toEqual([]);
  } finally {
    store.close();
  }
});

test.each([
  { remoteDeletion: false, localDeletion: false, followUp: false },
  { remoteDeletion: true, localDeletion: false, followUp: false },
  { remoteDeletion: false, localDeletion: true, followUp: false },
  { remoteDeletion: true, localDeletion: true, followUp: false },
  { remoteDeletion: false, localDeletion: false, followUp: true },
])(
  "private incremental pull maps two durable installations, preserves pending edits and rejects same-version content changes ($remoteDeletion / $localDeletion)",
  async ({ remoteDeletion, localDeletion, followUp }) => {
    const remoteActor = {
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
    };
    const target = {
      targetKind: "TASK" as const,
      targetId: crypto.randomUUID(),
    };
    const remote: EntityMemo = {
      ...target,
      id: await deriveEntityMemoId(remoteActor, target),
      workspaceId: remoteActor.workspaceId,
      ownerPrincipalId: remoteActor.principalId,
      bodyMd: "remote original\n",
      version: 1,
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
      createdBy: remoteActor.principalId,
      updatedBy: remoteActor.principalId,
      deletedAt: null,
    };
    const ids: string[] = [];
    for (let installation = 0; installation < 2; installation++) {
      const own = {
        schemaVersion: 1 as const,
        workspaceId: crypto.randomUUID(),
        principalId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
      };
      const factory = new IDBFactory();
      let store = await IndexedDbLocalStore.open("memo-pull", factory);
      const scope = {
        workspaceId: own.workspaceId,
        remoteWorkspaceId: remoteActor.workspaceId,
        remotePrincipalId: remoteActor.principalId,
        serverOrigin: "https://example.test",
        epoch: "epoch",
        version: 1,
        cursor: 0,
      };
      const identity = {
        forTarget: deriveEntityMemoId,
        nextChangeId: () => crypto.randomUUID(),
      };
      const runtime = () =>
        new LocalRuntime(
          new LocalWorkspace(
            store.metadata,
            {
              get: async () => null,
              put: async () => {
                throw new Error("UNEXPECTED_BINARY_WRITE");
              },
            },
            own,
            { extract: () => [], resolve: () => [] },
            { now: () => "2026-10-16T01:00:00.000Z" },
            { next: () => crypto.randomUUID() },
          ),
          identity,
        );
      try {
        await store.identity.ensure(own);
        await store.syncState.save(scope, null);
        const page = {
          epoch: "epoch",
          cursor: 2,
          recovery: false,
          hasMore: false,
          snapshot: null,
          records: [
            {
              seq: 1,
              workspaceId: remoteActor.workspaceId,
              collection: "items",
              entityId: target.targetId,
              op: "UPSERT",
              version: 1,
            },
            {
              seq: 2,
              workspaceId: remoteActor.workspaceId,
              collection: "entityMemos",
              entityId: remote.id,
              op: "UPSERT",
              version: 1,
            },
          ],
          changes: {
            values: {},
            collections: {
              items: {
                upserts: [work(target.targetId, remoteActor.workspaceId)],
                removed: [],
              },
              entityMemos: { upserts: [remote], removed: [] as string[] },
            },
          },
        };
        await store.replica.commit(
          (await prepareLocalWorkPull(
            runtime().context,
            scope,
            page,
            [],
            store.metadata,
            identity,
          ))!,
        );
        const localId = await deriveEntityMemoId(runtime().context, target);
        ids.push(localId);
        expect(await runtime().getEntityMemo(target)).toMatchObject({
          id: localId,
          bodyMd: remote.bodyMd,
          ownerPrincipalId: own.principalId,
          workspaceId: own.workspaceId,
        });
        store.close();
        store = await IndexedDbLocalStore.open("memo-pull", factory);
        const nextScope = (await store.syncState.get(own.workspaceId))!;
        const nextPage = {
          ...page,
          cursor: 3,
          records: [
            {
              seq: 3,
              workspaceId: remoteActor.workspaceId,
              collection: "entityMemos",
              entityId: remote.id,
              op: "UPSERT",
              version: 1,
            },
          ],
          changes: {
            values: {},
            collections: {
              entityMemos: {
                upserts: [{ ...remote, bodyMd: "forged same version" }],
                removed: [] as string[],
              },
            },
          },
        };
        const before = await store.metadata.exportWorkspace!(own.workspaceId);
        await expect(
          prepareLocalWorkPull(
            runtime().context,
            nextScope,
            nextPage,
            [],
            store.metadata,
            identity,
          ),
        ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
        expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
          before,
        );
        let localDraft = await runtime().saveEntityMemo(
          { ...target, bodyMd: "local offline draft" },
          1,
          localDeletion,
        );
        if (localDeletion) {
          expect(localDraft).toMatchObject({
            version: 2,
            deletedAt: "2026-10-16T01:00:00.000Z",
          });
          expect(
            await store.metadata.get(own.workspaceId, "entityMemos", localId),
          ).toMatchObject({ value: localDraft });
          localDraft = null;
        }
        let pending = await store.outbox.list(own.workspaceId);
        nextPage.records[0]!.version = 2;
        nextPage.changes.collections.entityMemos.upserts = [
          {
            ...remote,
            version: 2,
            bodyMd: "concurrent remote draft",
            deletedAt: remoteDeletion ? "2026-10-16T01:00:00Z" : null,
          },
        ];
        await store.replica.commit(
          (await prepareLocalWorkPull(
            runtime().context,
            nextScope,
            nextPage,
            pending,
            store.metadata,
            identity,
          ))!,
        );
        expect(await runtime().getEntityMemo(target)).toEqual(localDraft);
        expect(await store.outbox.list(own.workspaceId)).toEqual(pending);
        expect(
          await store.metadata.get(
            own.workspaceId,
            "$local.remoteBase",
            JSON.stringify(["entityMemos", localId]),
          ),
        ).toMatchObject({
          value: {
            remoteId: remote.id,
            version: 2,
            value: { bodyMd: "concurrent remote draft" },
          },
        });
        const conflictScope = bound(await store.syncState.get(own.workspaceId));
        const localPlan = (
          await planLocalCommands(runtime().context, store.metadata, pending)
        ).find((plan) => plan.command?.name === "memo.save")!;
        expect(
          await prepareLocalPendingWorkRebase(
            runtime().context,
            conflictScope,
            localPlan,
            pending,
            store.metadata,
            { next: () => crypto.randomUUID() },
            { now: () => "2026-10-16T02:00:00Z" },
            undefined,
            undefined,
            identity,
          ),
        ).toBeNull();
        const sending = (
          await store.outbox.transitionMany(
            localPlan.mutations.map((m) => ({
              workspaceId: own.workspaceId,
              mutationId: m.id,
              binding: conflictScope,
              expectedState: "PENDING" as const,
              expectedAttemptCount: 0,
              expectedLastAttemptAt: null,
              nextState: "SENDING" as const,
              at: "2026-10-16T01:00:00Z",
            })),
          )
        )[0]!;
        await store.outbox.transitionMany([
          {
            workspaceId: own.workspaceId,
            mutationId: sending.id,
            binding: conflictScope,
            expectedState: "SENDING",
            expectedAttemptCount: sending.attemptCount,
            expectedLastAttemptAt: sending.lastAttemptAt,
            nextState: "CONFLICT",
            at: "2026-10-16T01:01:00Z",
          },
        ]);
        pending = await store.outbox.list(own.workspaceId);
        const review = (
          await listLocalWorkConflictReviews(
            runtime().context,
            conflictScope,
            store.metadata,
            store.outbox,
          )
        )[0]!;
        const plan = (
          await planLocalCommands(runtime().context, store.metadata, pending)
        ).find((plan) => plan.id === localPlan.id)!;
        const choice =
          installation === 0 ? ("LOCAL" as const) : ("REMOTE" as const);
        const stale = {
          ...review,
          expectedWorkspaceVersion: review.expectedWorkspaceVersion! + 1,
        };
        await expect(
          prepareLocalPendingWorkRebase(
            runtime().context,
            conflictScope,
            plan,
            pending,
            store.metadata,
            { next: () => crypto.randomUUID() },
            { now: () => "2026-10-16T02:00:00Z" },
            { captured: stale, choice },
            undefined,
            identity,
          ),
        ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
        const replacement = (await prepareLocalPendingWorkRebase(
          runtime().context,
          conflictScope,
          plan,
          pending,
          store.metadata,
          { next: () => crypto.randomUUID() },
          { now: () => "2026-10-16T02:00:00Z" },
          { captured: review, choice },
          undefined,
          identity,
        ))!;
        expect(replacement.replacement.mutation.basePayload).toMatchObject({
          id: localId,
          ownerPrincipalId: own.principalId,
          bodyMd: "concurrent remote draft",
          version: 2,
        });
        await store.pendingWorkRebase.commit(replacement);
        localDraft = await runtime().getEntityMemo(target);
        const isDeleted = choice === "LOCAL" ? localDeletion : remoteDeletion;
        expect(
          await store.metadata.get(own.workspaceId, "entityMemos", localId),
        ).toMatchObject({
          value: {
            id: localId,
            ownerPrincipalId: own.principalId,
            version: 3,
            bodyMd:
              choice === "LOCAL"
                ? "local offline draft"
                : "concurrent remote draft",
            deletedAt: isDeleted
              ? choice === "LOCAL"
                ? "2026-10-16T01:00:00.000Z"
                : "2026-10-16T01:00:00Z"
              : null,
          },
        });
        if (isDeleted) expect(localDraft).toBeNull();
        else
          expect(localDraft).toMatchObject({
            id: localId,
            version: 3,
            deletedAt: null,
          });
        pending = await store.outbox.list(own.workspaceId);
        expect(pending).toHaveLength(1);
        expect(pending[0]!.id).not.toBe(plan.id);
        expect(
          await store.metadata.get(
            own.workspaceId,
            "$local.superseded",
            plan.id,
          ),
        ).toMatchObject({
          value: { original: review.original, replacementId: pending[0]!.id },
        });
        const deleteScope = (await store.syncState.get(own.workspaceId))!;
        const deletedPage = {
          ...nextPage,
          cursor: 4,
          records: [
            { ...nextPage.records[0]!, seq: 4, op: "DELETE", version: 2 },
          ],
          changes: {
            values: {},
            collections: { entityMemos: { upserts: [], removed: [remote.id] } },
          },
        };
        await store.replica.commit(
          (await prepareLocalWorkPull(
            runtime().context,
            deleteScope,
            deletedPage,
            pending,
            store.metadata,
            identity,
          ))!,
        );
        expect(await runtime().getEntityMemo(target)).toEqual(localDraft);
        expect(await store.outbox.list(own.workspaceId)).toEqual(pending);
        expect(
          await store.metadata.get(
            own.workspaceId,
            "$local.remoteBase",
            JSON.stringify(["entityMemos", localId]),
          ),
        ).toMatchObject({
          value: { remoteId: remote.id, version: 3, value: null },
        });
        if (followUp) {
          const latest = await runtime().getEntityMemo(target);
          await runtime().saveEntityMemo(
            { ...target, bodyMd: "Sequential device intent after purge" },
            latest!.version,
          );
        }
        const purgeBinding = bound(await store.syncState.get(own.workspaceId));
        const purgeSending = (
          await store.outbox.transitionMany([
            {
              workspaceId: own.workspaceId,
              mutationId: pending[0]!.id,
              binding: purgeBinding,
              expectedState: "PENDING",
              expectedAttemptCount: 0,
              expectedLastAttemptAt: null,
              nextState: "SENDING",
              at: "2026-10-16T03:00:00Z",
            },
          ])
        )[0]!;
        await store.outbox.transitionMany([
          {
            workspaceId: own.workspaceId,
            mutationId: purgeSending.id,
            binding: purgeBinding,
            expectedState: "SENDING",
            expectedAttemptCount: purgeSending.attemptCount,
            expectedLastAttemptAt: purgeSending.lastAttemptAt,
            nextState: "CONFLICT",
            at: "2026-10-16T03:01:00Z",
          },
        ]);
        const purgeReview = (
          await listLocalWorkConflictReviews(
            runtime().context,
            purgeBinding,
            store.metadata,
            store.outbox,
          )
        )[0]!;
        expect(purgeReview.followers?.length ?? 0).toBe(followUp ? 1 : 0);
        let resolution = await prepareLocalPurgedMemo(
          runtime().context,
          purgeReview,
          store.metadata,
          store.outbox,
          identity,
          { now: () => "2026-10-16T03:02:00Z" },
        );
        const preserved = await store.metadata.exportWorkspace!(
          own.workspaceId,
        );
        if (followUp) {
          const forged = structuredClone(resolution);
          const evidence = localObject(forged.records[2]!.entity.value);
          if (!Array.isArray(evidence.followers))
            throw new Error("MISSING_FOLLOWER_EVIDENCE");
          localObject(evidence.followers[0]!).mutation = {};
          await expect(
            store.deletedKnowledge.commit(forged),
          ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        }
        await expect(
          store.deletedKnowledge.commit({
            ...resolution,
            actor: { ...resolution.actor, principalId: crypto.randomUUID() },
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          store.deletedKnowledge.commit({
            ...resolution,
            captured: {
              ...purgeReview,
              expectedWorkspaceVersion:
                purgeReview.expectedWorkspaceVersion! + 1,
            },
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
          preserved,
        );
        const advancedBinding = {
          ...purgeBinding,
          version: purgeBinding.version + 1,
        };
        await store.syncState.save(advancedBinding, purgeBinding.version);
        const beforeStaleCommit = await store.metadata.exportWorkspace!(
          own.workspaceId,
        );
        const beforeStaleOutbox = await store.outbox.list(own.workspaceId);
        await expect(
          store.deletedKnowledge.commit(resolution),
        ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
        expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
          beforeStaleCommit,
        );
        expect(await store.outbox.list(own.workspaceId)).toEqual(
          beforeStaleOutbox,
        );
        const renewed = (
          await listLocalWorkConflictReviews(
            runtime().context,
            advancedBinding,
            store.metadata,
            store.outbox,
          )
        )[0]!;
        resolution = await prepareLocalPurgedMemo(
          runtime().context,
          renewed,
          store.metadata,
          store.outbox,
          identity,
          { now: () => "2026-10-16T03:03:00Z" },
        );
        await store.deletedKnowledge.commit(resolution);
        expect(await store.outbox.list(own.workspaceId)).toEqual([]);
        expect(await runtime().getEntityMemo(target)).toBeNull();
        expect(
          await store.metadata.get(
            own.workspaceId,
            "$local.superseded",
            purgeReview.original.id,
          ),
        ).toMatchObject({
          value: {
            reason: "REVIEWED_MEMO_PURGE",
            original: purgeReview.original,
            originalCommand: purgeReview.originalCommand,
          },
        });
        const committed = await store.metadata.exportWorkspace!(
          own.workspaceId,
        );
        await expect(
          store.deletedKnowledge.commit(resolution),
        ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
        expect(await store.metadata.exportWorkspace!(own.workspaceId)).toEqual(
          committed,
        );
      } finally {
        store.close();
      }
    }
    expect(ids[0]).not.toBe(ids[1]);
  },
);
