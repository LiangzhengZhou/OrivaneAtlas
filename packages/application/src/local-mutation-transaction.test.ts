import { expect, it, vi } from "vitest";
import { LocalMutationTransaction } from "./local-mutation-transaction";
import type { LocalMetadataStore } from "./local-persistence";

function fixture() {
  let mutationCount = 0;
  const store: LocalMetadataStore = {
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    commit: vi.fn(async () => {}),
  };
  const begin = () =>
    LocalMutationTransaction.begin(
      store,
      { workspaceId: "workspace", principalId: "owner" },
      "device",
      { now: () => "2026-10-12T00:00:00Z" },
      { next: () => `mutation-${++mutationCount}` },
    );
  return { store, begin };
}

it("keeps bounded command and projection batches and rejects foreign adapter rows", async () => {
  const { store } = fixture();
  const getMany = vi.fn(
    async (
      workspaceId: string,
      refs: readonly { collection: string; id: string }[],
    ) =>
      refs.map((ref) => ({
        ...ref,
        workspaceId,
        version: 1,
        value: { body: "原始\r\n😀" },
      })),
  );
  const capable: LocalMetadataStore = { ...store, getMany };
  const refs = Array.from({ length: 257 }, (_, index) => ({
    collection: "$local.remoteBase",
    id: String(index),
  }));
  for (const projection of [true, false]) {
    getMany.mockClear();
    const transaction = await LocalMutationTransaction.begin(
      capable,
      { workspaceId: "workspace", principalId: "owner" },
      "device",
      { now: () => "2026-10-20T00:00:00Z" },
      { next: () => "unused" },
      projection,
    );
    expect((await transaction.getMany(refs)).map((row) => row?.id)).toEqual(
      refs.map((ref) => ref.id),
    );
    expect(getMany.mock.calls.map((call) => call[1].length)).toEqual([
      32, 32, 32, 32, 32, 32, 32, 32, 1,
    ]);
    getMany.mockImplementationOnce(async (_workspaceId, batch) =>
      batch.map((ref) => ({
        ...ref,
        workspaceId: "foreign",
        version: 1,
        value: { body: "hidden" },
      })),
    );
    await expect(transaction.getMany(refs)).rejects.toThrow(
      "LOCAL_DATA_CORRUPT",
    );
  }
});

it("delegates availability validation only within read projections and still rejects a later revision", async () => {
  const { store } = fixture();
  const validate = vi.fn(async () => [true]);
  store.validateLibraryBodyAvailability = validate;
  const check = {
    manifest: {
      workspaceId: "workspace",
      collection: "library",
      id: "doc",
      version: 1,
      value: null,
    },
    availability: null,
  };
  const create = (projection: boolean) =>
    LocalMutationTransaction.begin(
      store,
      { workspaceId: "workspace", principalId: "owner" },
      "device",
      { now: () => "2026-10-21T00:00:00Z" },
      { next: () => "unused" },
      projection,
    );
  expect(
    await (await create(false)).validateLibraryBodyAvailability([check]),
  ).toBeUndefined();
  expect(validate).not.toHaveBeenCalled();
  const projection = await create(true);
  expect(await projection.validateLibraryBodyAvailability([check])).toEqual([
    true,
  ]);
  expect(validate).toHaveBeenCalledWith("workspace", [check]);
  vi.mocked(store.get).mockResolvedValue({
    ...check.manifest,
    collection: "$local.workspace",
    id: "revision",
    version: 2,
  });
  await expect(projection.commit()).rejects.toThrow("VERSION_CONFLICT");
  expect(store.commit).not.toHaveBeenCalled();
  validate.mockResolvedValueOnce([]);
  await expect(
    (await create(true)).validateLibraryBodyAvailability([check]),
  ).rejects.toThrow("LOCAL_DATA_CORRUPT");
});

it("read projections reject business/body writes and still reject invalidated snapshots", async () => {
  const { store } = fixture();
  const tx = await LocalMutationTransaction.begin(
    store,
    { workspaceId: "workspace", principalId: "owner" },
    "device",
    { now: () => "2026-10-20T00:00:00Z" },
    { next: () => "unused" },
    true,
  );
  const entity = {
    workspaceId: "workspace",
    collection: "items",
    id: "task",
    version: 1,
    value: { title: "Forbidden" },
  };
  const fallback = tx.detachResult(entity);
  expect(fallback).toEqual(entity);
  expect(fallback).not.toBe(entity);
  expect(() => tx.stage(entity, null, "CREATE", entity.value)).toThrow(
    "FORBIDDEN",
  );
  expect(() =>
    tx.stageInternal({ ...entity, collection: "$local.noteBody" }, null),
  ).toThrow("FORBIDDEN");
  await tx.list("items");
  vi.mocked(store.get).mockResolvedValue({
    ...entity,
    collection: "$local.workspace",
    id: "revision",
    version: 2,
  });
  await expect(tx.commit()).rejects.toThrow("VERSION_CONFLICT");
  expect(() => tx.validatedRevision()).toThrow(
    "LOCAL_TRANSACTION_NOT_VALIDATED",
  );
  expect(store.commit).not.toHaveBeenCalled();
});

it.each([false, true])(
  "small batches retain staged values, duplicate isolation and scope validation (foreign=%s)",
  async (foreign) => {
    const { store, begin } = fixture();
    const entity = {
      workspaceId: "workspace",
      collection: "items",
      id: "task",
      version: 1,
      value: { title: "Original" },
    };
    store.getMany = vi.fn(
      async (
        _workspace: string,
        refs: readonly { collection: string; id: string }[],
      ) =>
        refs.map((ref) => ({
          ...entity,
          ...ref,
          workspaceId: foreign ? "foreign" : "workspace",
        })),
    );
    const tx = await begin();
    tx.stage(
      { ...entity, version: 2, value: { title: "Staged" } },
      1,
      "PATCH",
      { title: "Staged" },
    );
    const refs = Array.from({ length: 65 }, () => ({
      collection: "items",
      id: "task",
    }));
    if (foreign) {
      await expect(tx.getMany(refs)).rejects.toThrow("LOCAL_DATA_CORRUPT");
    } else {
      const rows = await tx.getMany(refs);
      expect(rows).toHaveLength(65);
      expect(rows[0]!.version).toBe(2);
      Object.assign(rows[0]!.value!, { title: "Caller changed" });
      expect(rows[1]!.value).toEqual({ title: "Staged" });
      expect(
        vi.mocked(store.getMany).mock.calls.map(([, batch]) => batch.length),
      ).toEqual([32, 32, 1]);
      const read = await begin();
      await read.getMany(refs);
      vi.mocked(store.get).mockResolvedValue({
        ...entity,
        collection: "$local.workspace",
        id: "revision",
        version: 2,
      });
      await expect(read.commit()).rejects.toThrow("VERSION_CONFLICT");
    }
    tx.abort();
    expect(store.commit).not.toHaveBeenCalled();
  },
);

it("shares only same-stage collection reads and overlays later writes without exposing mutable cached rows", async () => {
  const { store, begin } = fixture();
  const entity = {
    workspaceId: "workspace",
    collection: "items",
    id: "task",
    version: 1,
    value: { title: "Original" },
  };
  vi.mocked(store.list).mockResolvedValue([entity]);
  const tx = await begin();
  const [first, second] = await Promise.all([
    tx.list("items"),
    tx.list("items"),
  ]);
  Object.assign(first[0]!.value!, { title: "Caller changed" });
  expect(second[0]!.value).toEqual({ title: "Original" });
  tx.stage({ ...entity, version: 2, value: { title: "Staged" } }, 1, "PATCH", {
    title: "Staged",
  });
  expect((await tx.list("items"))[0]!.value).toEqual({ title: "Staged" });
  expect(store.list).toHaveBeenCalledTimes(1);
  tx.abort();
  await (await begin()).list("items");
  expect(store.list).toHaveBeenCalledTimes(2);
});

it("keeps original logical command and all ordered effects in the same durable commit", async () => {
  const { store, begin } = fixture();
  const tx = await begin();
  for (const id of ["project", "task"])
    tx.stage(
      {
        workspaceId: "workspace",
        collection: "items",
        id,
        version: 1,
        value: { title: id },
      },
      null,
      "CREATE",
      { title: id },
    );
  const input = {
    id: "project",
    version: 3,
    input: {
      projectLifecycle: "COMPLETED",
      completionResolution: { action: "INBOX" },
    },
  };
  tx.recordCommand({ name: "work.update", input });
  input.input.completionResolution.action = "Caller changed";
  expect(() => tx.recordCommand({ name: "work.update", input })).toThrow(
    "VALIDATION_ERROR",
  );
  expect(() =>
    tx.stage(
      {
        workspaceId: "workspace",
        collection: "items",
        id: "late",
        version: 1,
        value: {},
      },
      null,
      "CREATE",
      {},
    ),
  ).toThrow("VALIDATION_ERROR");
  await tx.commit();
  const [, , writes, records] = vi.mocked(store.commit).mock.calls[0]!;
  expect(
    writes.map((write) => [write.mutation.id, write.mutation.commandId]),
  ).toEqual([
    ["mutation-1", "mutation-1"],
    ["mutation-2", "mutation-1"],
  ]);
  expect(
    records?.find((record) => record.entity.collection === "$local.command")
      ?.entity,
  ).toEqual({
    workspaceId: "workspace",
    collection: "$local.command",
    id: "mutation-1",
    version: 1,
    value: {
      id: "mutation-1",
      schemaVersion: 1,
      workspaceId: "workspace",
      principalId: "owner",
      name: "work.update",
      input: {
        id: "project",
        version: 3,
        input: {
          projectLifecycle: "COMPLETED",
          completionResolution: { action: "INBOX" },
        },
      },
      mutationIds: ["mutation-1", "mutation-2"],
    },
  });
});

it("aborted command groups leave no durable intent or effects", async () => {
  const { store, begin } = fixture();
  const tx = await begin();
  tx.stage(
    {
      workspaceId: "workspace",
      collection: "items",
      id: "task",
      version: 1,
      value: {},
    },
    null,
    "CREATE",
    {},
  );
  tx.recordCommand({
    name: "work.create",
    input: { id: "task", input: { title: "Task" } },
  });
  tx.abort();
  await expect(tx.commit()).rejects.toThrow("LOCAL_TRANSACTION_CLOSED");
  expect(store.commit).not.toHaveBeenCalled();
});

it("rejects a mixed read-only snapshot when another durable transaction changed its workspace", async () => {
  const { store, begin } = fixture();
  const tx = await begin();
  vi.mocked(store.get).mockResolvedValue({
    workspaceId: "workspace",
    collection: "$local.workspace",
    id: "revision",
    version: 1,
    value: { revision: 1 },
  });
  await expect(tx.commit()).rejects.toThrow("VERSION_CONFLICT");
  expect(store.commit).not.toHaveBeenCalled();
});

it("rejects foreign actors and prevents internal records from bypassing a business mutation", async () => {
  const { store, begin } = fixture();
  const tx = await begin();
  expect(() =>
    tx.stage(
      {
        workspaceId: "foreign",
        collection: "tasks",
        id: "task",
        version: 1,
        value: {},
      },
      null,
      "CREATE",
      {},
    ),
  ).toThrow("FORBIDDEN");
  tx.stageInternal(
    {
      workspaceId: "workspace",
      collection: "$local.body",
      id: "body",
      version: 1,
      value: { bodyMd: "Original" },
    },
    null,
  );
  await expect(tx.commit()).rejects.toThrow("VALIDATION_ERROR");
  expect(store.commit).not.toHaveBeenCalled();
});

it("returns detached staged values and abort leaves the durable store untouched", async () => {
  const { store, begin } = fixture();
  const tx = await begin();
  const value = { title: "Original" };
  tx.stage(
    {
      workspaceId: "workspace",
      collection: "tasks",
      id: "task",
      version: 1,
      value,
    },
    null,
    "CREATE",
    value,
  );
  value.title = "Caller changed";
  expect((await tx.get("tasks", "task"))?.value).toEqual({ title: "Original" });
  tx.abort();
  await expect(tx.commit()).rejects.toThrow("LOCAL_TRANSACTION_CLOSED");
  expect(store.commit).not.toHaveBeenCalled();
});

it("propagates persistence failure and disallows an accidental second submission", async () => {
  const { store, begin } = fixture();
  const failure = new Error("PERSISTENCE_UNAVAILABLE");
  vi.mocked(store.commit).mockRejectedValue(failure);
  const tx = await begin();
  tx.stage(
    {
      workspaceId: "workspace",
      collection: "tasks",
      id: "task",
      version: 1,
      value: {},
    },
    null,
    "CREATE",
    {},
  );
  await expect(tx.commit()).rejects.toBe(failure);
  await expect(tx.commit()).rejects.toThrow("LOCAL_TRANSACTION_CLOSED");
  expect(store.commit).toHaveBeenCalledTimes(1);
});

it("preserves each causal mutation when a business transaction reconciles the same entity twice", async () => {
  const { store, begin } = fixture();
  const tx = await begin();
  tx.stage(
    {
      workspaceId: "workspace",
      collection: "tasks",
      id: "task",
      version: 1,
      value: { title: "Created" },
    },
    null,
    "CREATE",
    { title: "Created" },
  );
  tx.stage(
    {
      workspaceId: "workspace",
      collection: "tasks",
      id: "task",
      version: 2,
      value: { title: "Reconciled" },
    },
    1,
    "PATCH",
    { title: "Reconciled" },
  );
  expect(() =>
    tx.stage(
      {
        workspaceId: "workspace",
        collection: "tasks",
        id: "task",
        version: 2,
        value: {},
      },
      1,
      "PATCH",
      {},
    ),
  ).toThrow("VERSION_CONFLICT");
  expect((await tx.get("tasks", "task"))?.version).toBe(2);
  await tx.commit();
  const submitted = vi.mocked(store.commit).mock.calls[0]![2];
  expect(submitted.map((write) => write.mutation.id)).toEqual([
    "mutation-1",
    "mutation-2",
  ]);
  expect(submitted.map((write) => write.expectedVersion)).toEqual([null, 1]);
  expect(submitted.map((write) => write.mutation.order)).toEqual([
    { transactionVersion: 1, operationIndex: 0 },
    { transactionVersion: 1, operationIndex: 1 },
  ]);
});

it("keeps a detached original base with the durable mutation rather than caller-owned state", async () => {
  const { store, begin } = fixture();
  const tx = await begin();
  const base = { title: "Before", descriptionMd: "第一行\n第二行" };
  tx.stage(
    {
      workspaceId: "workspace",
      collection: "tasks",
      id: "task",
      version: 2,
      value: { ...base, title: "After" },
    },
    1,
    "PATCH",
    { ...base, title: "After" },
    base,
  );
  base.title = "Mutated by caller";
  await tx.commit();
  const writes = vi.mocked(store.commit).mock.calls[0]![2];
  expect(writes[0]!.mutation.basePayload).toEqual({
    title: "Before",
    descriptionMd: "第一行\n第二行",
  });
  expect(writes[0]!.mutation.payload).toEqual({
    title: "After",
    descriptionMd: "第一行\n第二行",
  });
});
