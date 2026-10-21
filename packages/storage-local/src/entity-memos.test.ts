import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import { EntityMemoService } from "../../application/src/entity-memos";
import { LocalEntityMemoUnitOfWork } from "../../application/src/local-entity-memos";
import { deriveEntityMemoId } from "./entity-memo-identity";
import { IndexedDbLocalStore } from "./indexed-db";

test("product LocalRuntime stages private Memo commands with the normal workspace transaction", async () => {
  const factory = new IDBFactory();
  const identity = {
    schemaVersion: 1 as const,
    workspaceId: crypto.randomUUID(),
    principalId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
  };
  const clock = { now: () => "2026-10-16T00:00:00.000Z" };
  const ids = { next: () => crypto.randomUUID() };
  let store = await IndexedDbLocalStore.open("memo-product", factory);
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
        identity,
        { extract: () => [], resolve: () => [] },
        clock,
        ids,
      ),
      { forTarget: deriveEntityMemoId, nextChangeId: ids.next },
    );
  try {
    await store.identity.ensure(identity);
    const local = runtime();
    const task = await local.service.create(local.context, {
      type: "TASK",
      title: "Memo target",
    });
    const input = {
      targetKind: "TASK" as const,
      targetId: task.id,
      bodyMd: "  原始正文\n",
    };
    const before = await store.outbox.list(identity.workspaceId);
    expect(
      await local.saveEntityMemo({ ...input, bodyMd: " \n" }, 0),
    ).toBeNull();
    expect(await store.outbox.list(identity.workspaceId)).toEqual(before);
    const memo = await local.saveEntityMemo(input, 0);
    expect(memo?.id).toBe(await deriveEntityMemoId(local.context, input));
    expect(await local.getEntityMemo(input)).toEqual(memo);
    const command = (
      await store.metadata.list(identity.workspaceId, "$local.command")
    ).find(
      (record) =>
        record.value &&
        typeof record.value === "object" &&
        !Array.isArray(record.value) &&
        "name" in record.value &&
        record.value.name === "memo.save",
    );
    expect(command).toMatchObject({
      value: { input: { id: memo!.id, version: 0, input, deleted: false } },
    });
    const pending = await store.outbox.list(identity.workspaceId);
    expect(
      pending.filter((entry) => entry.entityType === "entityMemos"),
    ).toHaveLength(1);
    store.close();
    store = await IndexedDbLocalStore.open("memo-product", factory);
    expect(await runtime().getEntityMemo(input)).toEqual(memo);
    await expect(
      runtime().saveEntityMemo({ ...input, bodyMd: "Stale overwrite" }, 0),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await store.outbox.list(identity.workspaceId)).toEqual(pending);
    expect(await runtime().getEntityMemo(input)).toEqual(memo);
    const deleted = await runtime().service.setDeleted(
      local.context,
      task.id,
      task.version,
      true,
    );
    expect(await runtime().getEntityMemo(input)).toBeNull();
    const reopened = await runtime().service.setDeleted(
      local.context,
      task.id,
      deleted.version,
      false,
    );
    expect(await runtime().getEntityMemo(input)).toEqual(memo);
    const deletedAgain = await runtime().service.setDeleted(
      local.context,
      task.id,
      reopened.version,
      true,
    );
    await runtime().service.purge(local.context, task.id, deletedAgain.version);
    expect(await runtime().getEntityMemo(input)).toBeNull();
    expect(
      await store.metadata.get(identity.workspaceId, "entityMemos", memo!.id),
    ).toMatchObject({ value: { localTombstone: true } });
    expect(
      (await store.metadata.get(identity.workspaceId, "entityMemos", memo!.id))!
        .value,
    ).not.toHaveProperty("bodyMd");
  } finally {
    store.close();
  }
});

test("private memo and its Outbox survive closing and reopening real IndexedDB", async () => {
  const factory = new IDBFactory();
  const identity = {
    schemaVersion: 1 as const,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    deviceId: "33333333-3333-4333-8333-333333333333",
  };
  const context = {
    workspaceId: identity.workspaceId,
    principalId: identity.principalId,
  };
  const clock = { now: () => "2026-10-16T00:00:00.000Z" };
  const ids = { next: () => crypto.randomUUID() };
  const stableId = "44444444-4444-4444-8444-444444444444";
  let store = await IndexedDbLocalStore.open("memo-durable", factory);
  await store.identity.ensure(identity);
  const service = () =>
    new EntityMemoService(
      new LocalEntityMemoUnitOfWork(store.metadata, identity, clock, ids),
      { require: async () => {} },
      clock,
      { forTarget: async () => stableId, nextChangeId: ids.next },
    );
  try {
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        store.metadata,
        {
          get: async () => null,
          put: async () => {
            throw new Error("unexpected binary write");
          },
        },
        identity,
        { extract: () => [], resolve: () => [] },
        clock,
        ids,
      ),
    );
    const task = await runtime.service.create(context, {
      title: "Memo owner",
      type: "TASK",
    });
    const input = {
      targetKind: "TASK" as const,
      targetId: task.id,
      bodyMd: "  私人\n第二行\n",
    };
    await service().save(context, input, 0);
    const updated = await service().save(
      context,
      { ...input, bodyMd: "Revised original\n" },
      1,
    );
    expect(updated).toMatchObject({ id: stableId, version: 2 });
    const mutations = await store.outbox.list(identity.workspaceId);
    expect(
      mutations.filter((row) => row.entityType === "entityMemos"),
    ).toHaveLength(2);
    const memoMutations = mutations.filter(
      (row) => row.entityType === "entityMemos",
    );
    const captured = await store.metadata.list(
      identity.workspaceId,
      "$local.command",
    );
    for (const [index, mutation] of memoMutations.entries()) {
      expect(mutation.commandId).toBe(mutation.id);
      expect(
        captured.find((record) => record.id === mutation.commandId),
      ).toMatchObject({
        value: {
          name: "memo.save",
          principalId: context.principalId,
          mutationIds: [mutation.id],
          input: {
            id: stableId,
            version: index,
            input: {
              ...input,
              bodyMd: index === 0 ? input.bodyMd : "Revised original\n",
            },
            deleted: false,
          },
        },
      });
    }
    expect(
      await store.metadata.list(
        identity.workspaceId,
        "$local.entityMemosActivity",
      ),
    ).toHaveLength(2);
    expect(
      await store.metadata.get(
        identity.workspaceId,
        "$local.changes",
        "cursor",
      ),
    ).toMatchObject({ value: { seq: 3 } });
    store.close();
    store = await IndexedDbLocalStore.open("memo-durable", factory);
    expect(await service().get(context, input)).toEqual(updated);
    await expect(service().save(context, input, 1)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    await expect(
      service().get({ ...context, principalId: "other" }, input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await store.outbox.list(identity.workspaceId)).toEqual(mutations);
    const archive = await store.metadata.exportWorkspace!(identity.workspaceId);
    const restored = await IndexedDbLocalStore.open("memo-restored", factory);
    const restoredIdentity = {
      ...identity,
      deviceId: "55555555-5555-4555-8555-555555555555",
    };
    try {
      await restored.metadata.restoreEmptyWorkspace!(
        archive,
        restoredIdentity.deviceId,
      );
      const restoredService = new EntityMemoService(
        new LocalEntityMemoUnitOfWork(
          restored.metadata,
          restoredIdentity,
          clock,
          ids,
        ),
        { require: async () => {} },
        clock,
        { forTarget: async () => stableId, nextChangeId: ids.next },
      );
      expect(await restored.identity.get()).toEqual(restoredIdentity);
      expect(await restoredService.get(context, input)).toEqual(updated);
      expect(await restored.outbox.list(identity.workspaceId)).toEqual(
        mutations,
      );
      expect(
        await restored.metadata.list(identity.workspaceId, "$local.command"),
      ).toEqual(captured);
      await expect(
        restoredService.save(context, input, 1),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      expect(await service().get(context, input)).toEqual(updated);
    } finally {
      restored.close();
    }
  } finally {
    store.close();
  }
});
