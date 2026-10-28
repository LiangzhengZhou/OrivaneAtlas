import { type LocalSyncState, readLegacyImage } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import {
  exportLocalWorkspace,
  restoreLocalWorkspace,
} from "../../application/src/local-backup";
import { IndexedDbLocalBlobStore } from "./blob-store";
import { IndexedDbLocalStore } from "./indexed-db";

const own = {
  schemaVersion: 1 as const,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
};
const bytes = new Blob(
  [
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=",
      "base64",
    ),
  ],
  { type: "image/png" },
);
async function fixture() {
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("legacy", factory);
  const blobs = await IndexedDbLocalBlobStore.open("legacy", factory);
  const state: LocalSyncState = {
    workspaceId: own.workspaceId,
    remoteWorkspaceId: "remote",
    remotePrincipalId: "remote-owner",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 10,
    version: 1,
  };
  await store.metadata.restoreEmptyWorkspace!(
    {
      schemaVersion: 2,
      identity: own,
      syncState: state,
      entities: [],
      mutations: [],
    },
    own.deviceId,
  );
  const binding = async () => (await store.syncState.get(own.workspaceId))!;
  const ports = {
    binding,
    metadata: store.metadata,
    replica: store.replica,
    blobs,
    offline: false,
    download: vi.fn(async () => bytes),
  };
  return { factory, store, blobs, ports };
}

it("persists original bytes across reopen and backup/restore, without an Outbox or cursor change", async () => {
  const { factory, store, blobs, ports } = await fixture();
  try {
    const result = await readLegacyImage(own, "asset", ports);
    expect(await result.arrayBuffer()).toEqual(await bytes.arrayBuffer());
    expect((await store.syncState.get(own.workspaceId))!.cursor).toBe(10);
    const archive = await store.metadata.exportWorkspace!(own.workspaceId);
    expect(archive.mutations).toEqual([]);
    const backup = await exportLocalWorkspace(
      own.workspaceId,
      store.metadata,
      blobs,
    );
    const reopened = await IndexedDbLocalStore.open("legacy", factory);
    const restored = await IndexedDbLocalStore.open("restored", factory);
    const restoredBlobs = await IndexedDbLocalBlobStore.open(
      "restored",
      factory,
    );
    try {
      await restoreLocalWorkspace(
        backup,
        "44444444-4444-4444-8444-444444444444",
        restored.metadata,
        restoredBlobs,
      );
      for (const [target, binary] of [
        [reopened, blobs],
        [restored, restoredBlobs],
      ] as const) {
        const offline = await readLegacyImage(own, "asset", {
          ...ports,
          offline: true,
          metadata: target.metadata,
          blobs: binary,
          binding: async () => (await target.syncState.get(own.workspaceId))!,
        });
        expect(await offline.arrayBuffer()).toEqual(await bytes.arrayBuffer());
      }
      expect(ports.download).toHaveBeenCalledTimes(1);
    } finally {
      reopened.close();
      restored.close();
      restoredBlobs.close();
    }
  } finally {
    store.close();
    blobs.close();
  }
});

it("reuses an authorized cache copy without redownloading and never falls back on online denial", async () => {
  const { store, blobs, ports } = await fixture();
  try {
    await readLegacyImage(own, "asset", ports);
    expect(ports.download).toHaveBeenCalledTimes(1);
    const hash = (await blobs.digest!(bytes))!;
    const reused = await readLegacyImage(own, "asset", {
      ...ports,
      revalidateCache: vi.fn(async (_binding, contentHash) => {
        expect(contentHash).toBe(hash);
        return true;
      }),
    });
    expect(await reused.arrayBuffer()).toEqual(await bytes.arrayBuffer());
    expect(ports.download).toHaveBeenCalledTimes(1);
    await expect(
      readLegacyImage(own, "asset", {
        ...ports,
        revalidateCache: async () => {
          throw new Error("FORBIDDEN");
        },
      }),
    ).rejects.toThrow("FORBIDDEN");
    expect(ports.download).toHaveBeenCalledTimes(1);
    const refreshed = await readLegacyImage(own, "asset", {
      ...ports,
      revalidateCache: async () => false,
    });
    expect(await refreshed.arrayBuffer()).toEqual(await bytes.arrayBuffer());
    expect(ports.download).toHaveBeenCalledTimes(2);
  } finally {
    store.close();
    blobs.close();
  }
});

it("never falls back to private cached bytes after an online denial or across bindings", async () => {
  const { store, blobs, ports } = await fixture();
  try {
    await readLegacyImage(own, "asset", ports);
    ports.download.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(readLegacyImage(own, "asset", ports)).rejects.toThrow(
      "FORBIDDEN",
    );
    for (const field of [
      "serverOrigin",
      "remoteWorkspaceId",
      "remotePrincipalId",
      "epoch",
    ] as const) {
      await expect(
        readLegacyImage(own, "asset", {
          ...ports,
          offline: true,
          binding: async () => ({
            ...(await ports.binding()),
            [field]: "other",
          }),
        }),
      ).rejects.toThrow("NOT_FOUND");
    }
    await expect(
      readLegacyImage({ ...own, workspaceId: "foreign" }, "asset", ports),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      readLegacyImage({ ...own, principalId: "foreign" }, "asset", {
        ...ports,
        offline: true,
      }),
    ).rejects.toThrow("NOT_FOUND");
  } finally {
    store.close();
    blobs.close();
  }
});

it("concurrent image hydration retains every pointer and does not redownload on cache CAS contention", async () => {
  const { store, blobs, ports } = await fixture();
  try {
    await Promise.all(
      ["png", "jpeg", "webp"].map((id) => readLegacyImage(own, id, ports)),
    );
    expect(
      await store.metadata.list(own.workspaceId, "$local.legacyImage"),
    ).toHaveLength(3);
    expect(ports.download).toHaveBeenCalledTimes(3);
    expect(
      (await store.metadata.exportWorkspace!(own.workspaceId)).mutations,
    ).toEqual([]);
    expect((await ports.binding()).cursor).toBe(10);
  } finally {
    store.close();
    blobs.close();
  }
});

it("does not publish invalid raster bytes or a download from a retired account", async () => {
  const { store, blobs, ports } = await fixture();
  try {
    ports.download.mockResolvedValueOnce(
      new Blob(["invalid image"], { type: "image/png" }),
    );
    await expect(readLegacyImage(own, "asset", ports)).rejects.toThrow(
      "VALIDATION_ERROR",
    );
    const original = await ports.binding();
    let changed = false;
    await expect(
      readLegacyImage(own, "asset", {
        ...ports,
        binding: async () => ({
          ...original,
          remotePrincipalId: changed ? "other" : original.remotePrincipalId!,
        }),
        download: async () => {
          changed = true;
          return bytes;
        },
      }),
    ).rejects.toThrow("FORBIDDEN");
    expect(
      await store.metadata.list(own.workspaceId, "$local.legacyImage"),
    ).toEqual([]);
    expect(
      (await store.metadata.exportWorkspace!(own.workspaceId)).mutations,
    ).toEqual([]);
  } finally {
    store.close();
    blobs.close();
  }
});
