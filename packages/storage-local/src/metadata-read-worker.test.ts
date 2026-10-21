import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";
import { encodeMetadataRows } from "./metadata-read-codec";
import { WorkerMetadataReader } from "./metadata-read-worker";
import { readMetadataRows } from "./metadata-read-worker-entry";

it("reads complete scoped pages and exact ordered duplicate/missing keys before resolving, preserving JSON and negative zero", async () => {
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("worker-read", factory);
  const own = {
    schemaVersion: 1 as const,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    deviceId: "33333333-3333-4333-8333-333333333333",
  };
  const entities = Array.from({ length: 257 }, (_, index) => ({
    workspaceId: own.workspaceId,
    collection: "library",
    id: String(index).padStart(4, "0"),
    version: 1,
    value: {
      bodyMd: "原始\r\n😀 " + index,
      nested: [null, false, { count: index }],
    },
  }));
  let database: IDBDatabase | undefined;
  try {
    await store.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity: own,
        syncState: null,
        mutations: [],
        entities,
      },
      own.deviceId,
    );
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open("worker-read");
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const calls = vi.spyOn(IDBObjectStore.prototype, "getAll");
    try {
      const request = {
        database: "worker-read",
        workspaceId: own.workspaceId,
        collection: "library",
      };
      const rows = await readMetadataRows(database, request);
      expect(rows).toEqual(entities);
      expect(calls).toHaveBeenCalledTimes(3);
      expect(
        new Set(
          calls.mock.contexts.map(
            (context) => (context as IDBObjectStore).transaction,
          ),
        ).size,
      ).toBe(1);
      const encoded = encodeMetadataRows(rows);
      const received = JSON.parse(encoded.json!);
      expect(received).toEqual(entities);
      Object.assign(received[0]!.value!, { bodyMd: "Message changed" });
      expect(rows[0]).toEqual(entities[0]);
      const pages: (typeof entities)[] = [];
      expect(
        await readMetadataRows(database, request, (page) =>
          pages.push(page as typeof entities),
        ),
      ).toEqual([]);
      expect(pages.map((page) => page.length)).toEqual([128, 128, 1]);
      expect(pages.flat()).toEqual(entities);
      expect(
        await readMetadataRows(database, {
          ...request,
          workspaceId: "foreign",
        }),
      ).toEqual([]);
      expect(
        (
          await readMetadataRows(database, {
            ...request,
            ids: ["0002", "0000", "0002", "missing"],
          })
        ).map((row) => row?.id ?? null),
      ).toEqual(["0002", "0000", "0002", null]);
      const ids = Array.from({ length: 128 }, (_, index) =>
        String(127 - index).padStart(4, "0"),
      );
      ids[64] = "missing";
      ids[65] = ids[0]!;
      const exact = await readMetadataRows(database, { ...request, ids });
      expect(exact).toEqual(
        ids.map((id) => entities.find((entity) => entity.id === id) ?? null),
      );
      const exactPages: (typeof exact)[] = [];
      expect(
        await readMetadataRows(database, { ...request, ids }, (page) =>
          exactPages.push([...page]),
        ),
      ).toEqual([]);
      expect(exactPages.map((page) => page.length)).toEqual([32, 32, 32, 32]);
      expect(exactPages.flat()).toEqual(exact);
      Object.assign(rows[0]!.value!, { bodyMd: "Caller changed" });
      expect(
        (await readMetadataRows(database, { ...request, ids: ["0000"] }))[0],
      ).toEqual(entities[0]);
      const special = [{ ...entities[0]!, value: { number: -0 } }];
      const negative = encodeMetadataRows(special);
      expect("rows" in negative).toBe(true);
      expect(
        Object.is((negative.rows![0]!.value as { number: number }).number, -0),
      ).toBe(true);
      expect(await store.outbox.list(own.workspaceId)).toEqual([]);
    } finally {
      calls.mockRestore();
    }
  } finally {
    database?.close();
    store.close();
    vi.unstubAllGlobals();
  }
});

it("isolates concurrent worker replies and disables a failed worker while rejecting all pending reads", async () => {
  const sent: { id: number }[] = [];
  const worker = {
    postMessage: (value: { id: number }) => sent.push(structuredClone(value)),
    terminate: vi.fn(),
    onmessage: undefined as ((event: MessageEvent) => void) | undefined,
    onerror: undefined as ((event: ErrorEvent) => void) | undefined,
  };
  const reader = new WorkerMetadataReader(() => worker as unknown as Worker);
  const request = {
    database: "database",
    workspaceId: "workspace",
    collection: "library",
  };
  const first = reader.read(request),
    second = reader.read(request);
  worker.onmessage!(
    new MessageEvent("message", { data: { id: sent[1]!.id, json: "[null]" } }),
  );
  worker.onmessage!(
    new MessageEvent("message", { data: { id: sent[0]!.id, json: "[]" } }),
  );
  expect(await first).toEqual([]);
  expect(await second).toEqual([null]);
  const paged = reader.read(request);
  let published = false;
  void paged.then(() => {
    published = true;
  });
  const pageId = sent[2]!.id;
  worker.onmessage!(
    new MessageEvent("message", {
      data: { id: pageId, page: true, json: "[null]" },
    }),
  );
  await Promise.resolve();
  expect(published).toBe(false);
  worker.onmessage!(
    new MessageEvent("message", { data: { id: pageId, done: true } }),
  );
  expect(await paged).toEqual([null]);
  const failed = reader.read(request);
  const failedId = sent[3]!.id;
  worker.onmessage!(
    new MessageEvent("message", {
      data: { id: failedId, page: true, json: "[null]" },
    }),
  );
  const rejected = expect(failed).rejects.toThrow(
    "LOCAL_READ_WORKER_UNAVAILABLE",
  );
  worker.onerror!({ preventDefault() {} } as ErrorEvent);
  await rejected;
  await expect(reader.read(request)).rejects.toThrow(
    "LOCAL_READ_WORKER_UNAVAILABLE",
  );
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  reader.close();
});

it("falls back to original IndexedDB reads after an unavailable worker without changing persisted values", async () => {
  const failed = {
    read: vi.fn(async () => {
      throw new Error("WORKER_UNSUPPORTED");
    }),
    close: vi.fn(),
  };
  const store = await IndexedDbLocalStore.open(
    "worker-fallback",
    new IDBFactory(),
    undefined,
    failed,
  );
  try {
    expect(await store.metadata.list("workspace", "library")).toEqual([]);
    expect(
      await store.metadata.getMany!("workspace", [
        { collection: "$local.remoteBase", id: "missing" },
      ]),
    ).toEqual([null]);
    expect(
      await store.metadata.getMany!(
        "workspace",
        Array.from({ length: 128 }, (_, index) => ({
          collection: "$local.remoteBase",
          id: String(index),
        })),
      ),
    ).toEqual(Array(128).fill(null));
    expect(failed.close).toHaveBeenCalled();
    expect(await store.outbox.list("workspace")).toEqual([]);
  } finally {
    store.close();
  }
});

it("queues complete metadata messages behind input without publishing partial pages or reviving a closed read", async () => {
  let focused = true;
  const operations: (() => void)[] = [];
  const scheduler = {
    postTask: vi.fn((operation: () => void) => {
      operations.push(operation);
      return Promise.resolve();
    }),
  };
  vi.stubGlobal("scheduler", scheduler);
  const sent: { id: number }[] = [];
  const worker = {
    postMessage: (value: { id: number }) => sent.push(structuredClone(value)),
    terminate: vi.fn(),
    onmessage: undefined as ((event: MessageEvent) => void) | undefined,
  };
  const reader = new WorkerMetadataReader(
    () => worker as unknown as Worker,
    () => focused,
  );
  try {
    const request = {
      database: "database",
      workspaceId: "workspace",
      collection: "library",
    };
    const reading = reader.read(request);
    let published = false;
    void reading.then(() => {
      published = true;
    });
    worker.onmessage!(
      new MessageEvent("message", {
        data: { id: sent[0]!.id, page: true, json: "[null]" },
      }),
    );
    focused = false;
    worker.onmessage!(
      new MessageEvent("message", { data: { id: sent[0]!.id, done: true } }),
    );
    expect(scheduler.postTask).toHaveBeenCalledWith(expect.any(Function), {
      priority: "background",
    });
    await Promise.resolve();
    expect(published).toBe(false);
    operations.shift()!();
    await Promise.resolve();
    expect(published).toBe(false);
    operations.shift()!();
    expect(await reading).toEqual([null]);
    focused = true;
    const closing = reader.read(request);
    const rejected = expect(closing).rejects.toThrow(
      "LOCAL_READ_WORKER_UNAVAILABLE",
    );
    worker.onmessage!(
      new MessageEvent("message", { data: { id: sent[1]!.id, json: "[]" } }),
    );
    reader.close();
    operations.shift()!();
    await rejected;
  } finally {
    reader.close();
    vi.unstubAllGlobals();
  }
});
