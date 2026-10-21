import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["dense", "paged", "sparse", "missing", "duplicate", "large"])(
  "bounded base reads retain exact values, order, scope and one transaction: %s",
  async (scenario) => {
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const store = await IndexedDbLocalStore.open(
      "base-range",
      new IDBFactory(),
    );
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const ids = Array.from(
      { length: scenario === "large" ? 129 : scenario === "paged" ? 128 : 32 },
      (_, index) => String(index).padStart(3, "0"),
    );
    const entities = ids
      .filter((id) => scenario !== "missing" || id !== "016")
      .map((id) => ({
        workspaceId: identity.workspaceId,
        collection: "$local.remoteBase",
        id,
        version: 1,
        value: { bodyMd: "原始\r\n😀 " + id },
      }));
    if (scenario === "sparse")
      entities.push({
        ...entities[0]!,
        id: "016a",
        value: { bodyMd: "UNREQUESTED_BODY" },
      });
    const refs = [...ids].reverse().map((id) => ({
      collection: "$local.remoteBase",
      id,
    }));
    if (scenario === "duplicate") refs[refs.length - 1]!.id = refs[0]!.id;
    const expected = refs.map((ref) =>
      scenario === "missing" && ref.id === "016" ? null : ref.id,
    );
    try {
      await store.metadata.restoreEmptyWorkspace!(
        {
          schemaVersion: 2,
          identity,
          syncState: null,
          mutations: [],
          entities: [
            ...entities,
            { ...entities[0]!, collection: "other-collection" },
          ],
        },
        identity.deviceId,
      );
      const values = vi.spyOn(IDBObjectStore.prototype, "getAll");
      const keys = vi.spyOn(IDBObjectStore.prototype, "getAllKeys");
      const exact = vi.spyOn(IDBObjectStore.prototype, "get");
      try {
        const reading = store.metadata.getMany!(identity.workspaceId, refs);
        refs[0]!.id = "Caller changed";
        const rows = await reading;
        expect(rows.map((row) => row?.id ?? null)).toEqual(expected);
        const dense = scenario === "dense";
        expect(values).toHaveBeenCalledTimes(
          dense ? Math.ceil(ids.length / 32) : 0,
        );
        expect(values.mock.calls.every((args) => Number(args[1]) <= 32)).toBe(
          true,
        );
        expect(keys).toHaveBeenCalledTimes(
          scenario === "duplicate" ||
            scenario === "large" ||
            scenario === "paged"
            ? 0
            : 1,
        );
        expect(exact).toHaveBeenCalledTimes(dense ? 0 : refs.length);
        expect(
          new Set(
            [
              ...values.mock.contexts,
              ...keys.mock.contexts,
              ...exact.mock.contexts,
            ].map((context) => (context as IDBObjectStore).transaction),
          ).size,
        ).toBe(1);
        expect(JSON.stringify(rows)).not.toContain("UNREQUESTED_BODY");
        expect(rows[0]!.value).toEqual({ bodyMd: "原始\r\n😀 " + expected[0] });
        Object.assign(rows[0]!.value!, { bodyMd: "Caller changed" });
        expect(
          (
            await store.metadata.get(
              identity.workspaceId,
              "$local.remoteBase",
              expected[0]!,
            )
          )?.value,
        ).toEqual({ bodyMd: "原始\r\n😀 " + expected[0] });
        expect(await store.metadata.getMany!("foreign", refs)).toEqual(
          refs.map(() => null),
        );
        expect(await store.outbox.list(identity.workspaceId)).toEqual([]);
      } finally {
        values.mockRestore();
        keys.mockRestore();
        exact.mockRestore();
      }
    } finally {
      store.close();
      vi.unstubAllGlobals();
    }
  },
);
