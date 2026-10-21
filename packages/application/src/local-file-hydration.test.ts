import { createHash } from "node:crypto";
import type { LibraryFile } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import { localDto } from "./local-dto";
import { hydrateLocalFileBytes } from "./local-file-hydration";
import type { LocalMetadataStore, LocalSyncState } from "./local-persistence";

function fixture() {
  const bytes = new Blob([new Uint8Array([0, 128, 255])]);
  const hash = createHash("sha256")
    .update(new Uint8Array([0, 128, 255]))
    .digest("hex");
  const state: LocalSyncState = {
    workspaceId: "local",
    remoteWorkspaceId: "remote",
    remotePrincipalId: "remote-owner",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 7,
    version: 1,
  };
  const file: LibraryFile = {
    id: "file",
    workspaceId: "local",
    spaceId: null,
    parentDocumentId: null,
    name: "Original.bin",
    originalName: "Original.bin",
    extension: "bin",
    mime: "application/octet-stream",
    size: 3,
    contentHash: hash,
    blobId: hash,
    version: 1,
    provenance: "HUMAN",
    aiPolicy: {
      classification: "PRIVATE",
      processingBoundary: "LOCAL_ONLY",
      aiAccess: "DENY",
    },
    extractionStatus: "NOT_APPLICABLE",
    indexStatus: "PENDING",
    createdBy: "owner",
    updatedBy: "owner",
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T00:00:00Z",
    deletedAt: null,
  };
  const metadata: LocalMetadataStore = {
    get: vi.fn(async (_workspace, collection, id) => ({
      workspaceId: "local",
      collection,
      id,
      version: 1,
      value:
        collection === "files"
          ? localDto(file)
          : localDto({ ...state, value: { ...file, workspaceId: "remote" } }),
    })),
    list: vi.fn(async () => []),
    commit: vi.fn(async () => {}),
  };
  const blobs = {
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
    digest: async (blob: Blob) =>
      createHash("sha256")
        .update(new Uint8Array(await blob.arrayBuffer()))
        .digest("hex"),
  };
  const download = vi.fn(async () => bytes);
  const run = () =>
    hydrateLocalFileBytes(
      { workspaceId: "local", principalId: "owner" },
      "file",
      metadata,
      blobs,
      async () => state,
      download,
    );
  return { run, metadata, blobs, download, file, state };
}

it("verifies original bytes without changing metadata, cursor or Outbox", async () => {
  const f = fixture();
  await f.run();
  expect(f.blobs.put).toHaveBeenCalledOnce();
  expect(f.metadata.commit).not.toHaveBeenCalled();
  expect(f.state.cursor).toBe(7);
});

it("rejects corrupt bytes and missing remote provenance before any durable binary write", async () => {
  const f = fixture();
  f.download.mockResolvedValue(new Blob([new Uint8Array([0, 128, 254])]));
  await expect(f.run()).rejects.toThrow("VALIDATION_ERROR");
  expect(f.blobs.put).not.toHaveBeenCalled();
  vi.mocked(f.metadata.get).mockResolvedValue(null);
  f.download.mockClear();
  await expect(f.run()).rejects.toThrow("FORBIDDEN");
  expect(f.download).not.toHaveBeenCalled();
});

it("binding changes and deletion during download prevent persistence", async () => {
  for (const change of ["binding", "delete"] as const) {
    const f = fixture();
    f.download.mockImplementation(async () => {
      if (change === "binding")
        Object.assign(f.state, { epoch: "replacement" });
      else Object.assign(f.file, { deletedAt: "2026-10-14T01:00:00Z" });
      return new Blob([new Uint8Array([0, 128, 255])]);
    });
    await expect(f.run()).rejects.toThrow(
      change === "binding" ? "VERSION_CONFLICT" : "NOT_FOUND",
    );
    expect(f.blobs.put).not.toHaveBeenCalled();
    expect(f.metadata.commit).not.toHaveBeenCalled();
  }
});

it("a File from a previous bound account cannot trigger a download", async () => {
  const f = fixture();
  const get = vi.mocked(f.metadata.get).getMockImplementation();
  if (!get) throw new Error("MISSING_FIXTURE_GET");
  vi.mocked(f.metadata.get).mockImplementation(
    async (workspace, collection, id) => {
      const record = await get(workspace, collection, id);
      if (record && collection === "$local.remoteBase")
        return {
          ...record,
          value: {
            ...(record.value as object),
            remotePrincipalId: "different-owner",
          },
        };
      return record;
    },
  );
  await expect(f.run()).rejects.toThrow("FORBIDDEN");
  expect(f.download).not.toHaveBeenCalled();
  expect(f.blobs.put).not.toHaveBeenCalled();
});

it("remote and local original MIME must agree before downloading bytes", async () => {
  const f = fixture();
  const get = vi.mocked(f.metadata.get).getMockImplementation();
  if (!get) throw new Error("MISSING_FIXTURE_GET");
  vi.mocked(f.metadata.get).mockImplementation(
    async (workspace, collection, id) => {
      const record = await get(workspace, collection, id);
      if (record && collection === "files")
        return {
          ...record,
          value: localDto({ ...f.file, mime: "text/plain" }),
        };
      return record;
    },
  );
  await expect(f.run()).rejects.toThrow("VERSION_CONFLICT");
  expect(f.download).not.toHaveBeenCalled();
  expect(f.blobs.put).not.toHaveBeenCalled();
});
