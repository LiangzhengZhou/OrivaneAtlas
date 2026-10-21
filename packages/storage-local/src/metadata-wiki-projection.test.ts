import { canonicalWikiLink, type LocalEntity } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";
import type { MetadataReadRequest } from "./metadata-read-worker";
import { projectCanonicalWikiRows } from "./metadata-read-worker-entry";

const identity = {
  schemaVersion: 1 as const,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
};
const row: LocalEntity = {
  workspaceId: identity.workspaceId,
  collection: "wikiLinks",
  id: "relation",
  version: 1,
  value: {
    workspaceId: identity.workspaceId,
    sourceDocumentId: "source",
    targetDocumentId: null,
    targetText: "正文\r\n😀",
    alias: "别名",
    heading: null,
    originalStoredField: "Keep this",
  },
};
const request: MetadataReadRequest = {
  database: "wiki",
  workspaceId: identity.workspaceId,
  collection: "wikiLinks",
  wikiSourceIds: ["source"],
};

it("projects all five exact Wiki fields, preserves order and tombstones, and rejects corrupt selected fields or foreign raw rows", () => {
  const sources = new Set(["source"]);
  const expected = canonicalWikiLink(row, identity.workspaceId, sources)!;
  expect(
    projectCanonicalWikiRows(request, [row, row]).map((value) => value.value),
  ).toEqual(
    Array(2).fill([
      expected.sourceDocumentId,
      expected.targetDocumentId,
      expected.targetText,
      expected.alias,
      expected.heading,
    ]),
  );
  expect(
    projectCanonicalWikiRows({ ...request, wikiSourceIds: [] }, [row]),
  ).toEqual([]);
  expect(
    projectCanonicalWikiRows(request, [
      { ...row, value: { localTombstone: true } },
    ]),
  ).toEqual([]);
  for (const changes of [
    { targetText: 42 },
    { alias: false },
    { heading: {} },
    { targetDocumentId: false },
    { workspaceId: "foreign" },
  ]) {
    const corrupt = {
      ...row,
      value: { ...(row.value as object), ...changes },
    } as LocalEntity;
    expect(() =>
      canonicalWikiLink(corrupt, identity.workspaceId, sources),
    ).toThrow("LOCAL_DATA_CORRUPT");
    expect(() => projectCanonicalWikiRows(request, [corrupt])).toThrow(
      "LOCAL_DATA_CORRUPT",
    );
  }
  expect(() =>
    projectCanonicalWikiRows({ ...request, wikiSourceIds: [] }, [
      { ...row, workspaceId: "foreign" },
    ]),
  ).toThrow("LOCAL_DATA_CORRUPT");
});

it.each(["working", "unsupported", "malformed"])(
  "reads exact canonical Wiki fields through %s projection without changing durable rows or outbox",
  async (mode) => {
    const reader = {
      read: vi.fn(async (query: MetadataReadRequest) => {
        if (mode === "unsupported") throw new Error("UNSUPPORTED");
        if (mode === "malformed")
          return [
            { ...row, value: ["wrong-source", null, "wrong", null, null] },
          ];
        return projectCanonicalWikiRows(query, [structuredClone(row)]);
      }),
      close: vi.fn(),
    };
    const store = await IndexedDbLocalStore.open(
      "wiki-" + mode,
      new IDBFactory(),
      undefined,
      reader,
    );
    try {
      await store.metadata.restoreEmptyWorkspace!(
        {
          schemaVersion: 2,
          identity,
          syncState: null,
          mutations: [],
          entities: [row],
        },
        identity.deviceId,
      );
      const expected = canonicalWikiLink(
        row,
        identity.workspaceId,
        new Set(["source"]),
      );
      const links = await store.metadata.readCanonicalWikiLinks!(
        identity.workspaceId,
        ["source"],
      );
      expect(links).toEqual([expected]);
      expect(reader.read).toHaveBeenCalledTimes(1);
      if (mode !== "working") expect(reader.close).toHaveBeenCalledTimes(1);
      Object.assign(links[0]!, { targetText: "Caller changed" });
      expect(
        await store.metadata.get(identity.workspaceId, "wikiLinks", row.id),
      ).toEqual(row);
      expect(
        await store.metadata.readCanonicalWikiLinks!(identity.workspaceId, []),
      ).toEqual([]);
      expect(await store.outbox.list(identity.workspaceId)).toEqual([]);
      if (mode === "working")
        expect(
          await store.metadata.readCanonicalWikiLinks!(identity.workspaceId, [
            "source",
            ...Array.from({ length: 8192 }, (_, index) => "other-" + index),
          ]),
        ).toEqual([expected]);
      expect(
        (await store.metadata.exportWorkspace!(identity.workspaceId)).entities,
      ).toEqual([row]);
    } finally {
      store.close();
    }
  },
);
