import { expect, it, vi } from "vitest";
import { LocalImageAssets, requireRasterImage } from "./local-image-assets";
import { LocalMutationTransaction } from "./local-mutation-transaction";
import type { LocalBlobStore, LocalMetadataStore } from "./local-persistence";

it("validates original raster bytes without modifying them or trusting MIME alone", async () => {
  const original = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0,
  ]);
  const png = new Blob([original], { type: "image/png" });
  await requireRasterImage(png);
  expect(new Uint8Array(await png.arrayBuffer())).toEqual(original);
  for (const blob of [
    new Blob(["not an image"], { type: "image/png" }),
    new Blob([original], { type: "image/svg+xml" }),
    new Blob([original.slice(0, 4)], { type: "image/png" }),
  ])
    await expect(requireRasterImage(blob)).rejects.toThrow("VALIDATION_ERROR");
});

async function fixture() {
  const actor = { workspaceId: "workspace", principalId: "owner" };
  const store: LocalMetadataStore = {
    get: vi.fn(async () => null),
    list: async () => [],
    commit: vi.fn(async () => {}),
  };
  const blobs: LocalBlobStore = {
    put: vi.fn(async () => {}),
    get: async () => null,
  };
  const clock = { now: () => "2026-10-12T00:00:00Z" },
    ids = { next: () => "mutation" };
  const stage = await LocalMutationTransaction.begin(
    store,
    actor,
    "device",
    clock,
    ids,
  );
  const assets = new LocalImageAssets(stage, blobs, actor, clock, ids, vi.fn());
  const image = {
    id: "image-0000000000000001",
    spaceId: null,
    name: "image.png",
    mime: "image/png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
  };
  return { store, blobs, assets, image };
}

it("rejects invalid format, chunk size, index and MIME before writing any bytes", async () => {
  const { assets, image, blobs, store } = await fixture();
  for (const [patch, index] of [
    [{ base64: "!!!!" }, 0],
    [{ base64: btoa("not a PNG file") }, 0],
    [{ mime: "text/html" }, 0],
    [{ base64: "A".repeat(349529) }, 0],
    [{}, -1],
    [{}, 400],
    [{}, 0.5],
  ] as const)
    await expect(
      assets.putAssetChunk({ ...image, ...patch }, index, true),
    ).rejects.toThrow("VALIDATION_ERROR");
  expect(blobs.put).not.toHaveBeenCalled();
  expect(store.commit).not.toHaveBeenCalled();
});

it("rejects a foreign Space and resumed-upload identity before storing a chunk", async () => {
  const { assets, image, blobs, store } = await fixture();
  vi.mocked(store.get).mockResolvedValueOnce({
    workspaceId: "workspace",
    collection: "library",
    id: "space",
    version: 1,
    value: { workspaceId: "foreign", kind: "SPACE", deletedAt: null },
  });
  await expect(
    assets.putAssetChunk({ ...image, spaceId: "space" }, 0, true),
  ).rejects.toThrow("NOT_FOUND");
  vi.mocked(store.get).mockResolvedValueOnce({
    workspaceId: "workspace",
    collection: "libraryAssets",
    id: image.id,
    version: 1,
    value: {
      workspaceId: "workspace",
      id: image.id,
      version: 1,
      principalId: "other",
      name: image.name,
      mime: image.mime,
      spaceId: null,
      state: "UPLOADING",
      chunkHashes: [],
      totalBytes: 0,
      updatedAt: "2026-10-12T00:00:00Z",
    },
  });
  await expect(assets.putAssetChunk(image, 0, true)).rejects.toThrow(
    "FORBIDDEN",
  );
  expect(blobs.put).not.toHaveBeenCalled();
});
