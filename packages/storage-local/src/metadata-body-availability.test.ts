import {
  type LocalEntity,
  remoteBodyUnavailable,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";
import { validateMetadataBodyRows } from "./metadata-read-worker-entry";

function fixture() {
  const identity = {
    schemaVersion: 1 as const,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    deviceId: "33333333-3333-4333-8333-333333333333",
  };
  const manifest: LocalEntity = {
    workspaceId: identity.workspaceId,
    collection: "library",
    id: "document",
    version: 1,
    value: {
      workspaceId: identity.workspaceId,
      id: "document",
      version: 1,
      bodyState: "UNLOADED",
      bodyCharacterCount: 12,
      title: "原始\r\n😀",
      aliases: ["Alias"],
      nested: { number: -0 },
    },
  };
  const binding = {
    serverOrigin: "https://example.test",
    remoteWorkspaceId: "remote",
    remotePrincipalId: "owner",
    epoch: "epoch",
  };
  const availability: LocalEntity = {
    ...manifest,
    collection: "$local.libraryBodyAvailability",
    value: {
      ...binding,
      collection: "library",
      id: manifest.id,
      state: "MISSING",
      entityVersion: 1,
    },
  };
  const base: LocalEntity = {
    ...manifest,
    collection: "$local.remoteBase",
    id: JSON.stringify(["library", manifest.id]),
    value: {
      ...binding,
      collection: "library",
      id: manifest.id,
      version: 1,
      value: { ...(manifest.value as object), workspaceId: "remote" },
    },
  };
  const checks = [{ manifest, availability }];
  const request = {
    database: "availability",
    workspaceId: identity.workspaceId,
    collection: "$local.remoteBase",
    ids: [base.id],
    libraryBodyChecks: checks,
  };
  return { identity, manifest, availability, base, checks, request };
}

it("executes the unchanged validator with exact full-field, identity and epoch rejection before compacting a result", () => {
  const { manifest, availability, base, request } = fixture();
  expect(validateMetadataBodyRows(request, [base])).toEqual([
    { ...base, value: true },
  ]);
  const invalidValues = [
    { ...(base.value as object), epoch: "other" },
    { ...(base.value as object), remotePrincipalId: "other" },
    { ...(base.value as object), version: 2 },
    {
      ...(base.value as object),
      value: {
        ...(manifest.value as object),
        workspaceId: "remote",
        title: "Corrupt",
      },
    },
    {
      ...(base.value as object),
      value: {
        ...(manifest.value as object),
        workspaceId: "remote",
        bodyMd: "hidden",
      },
    },
  ];
  for (const value of invalidValues) {
    const corrupt = { ...base, value } as LocalEntity;
    expect(() =>
      remoteBodyUnavailable("library", manifest, availability, corrupt),
    ).toThrow();
    expect(() => validateMetadataBodyRows(request, [corrupt])).toThrow();
  }
  expect(() => validateMetadataBodyRows(request, [null])).toThrow(
    "LOCAL_DATA_CORRUPT",
  );
  expect(() =>
    validateMetadataBodyRows(request, [{ ...base, workspaceId: "foreign" }]),
  ).toThrow("LOCAL_DATA_CORRUPT");
  expect(() =>
    validateMetadataBodyRows({ ...request, ids: ["wrong"] }, [base]),
  ).toThrow("LOCAL_DATA_CORRUPT");
  expect(() => validateMetadataBodyRows(request, [])).toThrow(
    "INVALID_READ_WORKER_REQUEST",
  );
});

it.each(["unsupported", "malformed"])(
  "falls back to real scoped IndexedDB validation after %s worker output",
  async (mode) => {
    const { identity, base, checks } = fixture();
    const reader = {
      read: vi.fn(async () => {
        if (mode === "unsupported") throw new Error("UNSUPPORTED");
        return [{ ...base, value: "untrusted" }];
      }),
      close: vi.fn(),
    };
    const store = await IndexedDbLocalStore.open(
      "availability-" + mode,
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
          entities: [base],
        },
        identity.deviceId,
      );
      expect(
        await store.metadata.validateLibraryBodyAvailability!(
          identity.workspaceId,
          checks,
        ),
      ).toEqual([true]);
      expect(reader.close).toHaveBeenCalled();
      expect(reader.read).toHaveBeenCalledTimes(1);
      await expect(
        store.metadata.validateLibraryBodyAvailability!("foreign", checks),
      ).rejects.toThrow("INVALID_WRITE");
      expect(await store.outbox.list(identity.workspaceId)).toEqual([]);
      expect(
        (await store.metadata.exportWorkspace!(identity.workspaceId)).entities,
      ).toEqual([base]);
    } finally {
      store.close();
    }
  },
);
