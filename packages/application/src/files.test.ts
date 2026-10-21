import { DomainError, type LibraryFile } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import { FileService, type LibraryFileStore } from "./files";
import type { LocalBlobStore } from "./local-persistence";

const actor = { workspaceId: "workspace", principalId: "owner" };
const stableFileId = "55555555-5555-4555-8555-555555555555";
it("policy changes authorize before reads and preserve originals with versioned writes", async () => {
  const { service, store, blobs, old } = fixture();
  const policy = {
    classification: "PRIVATE",
    processingBoundary: "LOCAL_ONLY",
    aiAccess: "ASK",
  } as const;
  await expect(
    service.setPolicy({ ...actor, principalId: "foreign" }, old.id, 1, policy),
  ).rejects.toThrow("FORBIDDEN");
  expect(store.get).not.toHaveBeenCalled();
  await expect(service.setPolicy(actor, old.id, 0, policy)).rejects.toThrow(
    "VERSION_CONFLICT",
  );
  expect(store.save).not.toHaveBeenCalled();
  const updated = await service.setPolicy(actor, old.id, 1, policy);
  expect(updated).toEqual({
    ...old,
    aiPolicy: policy,
    version: 2,
    updatedAt: "2026-10-13T00:00:00Z",
    updatedBy: actor.principalId,
  });
  expect(store.save).toHaveBeenCalledWith(updated, 1);
  expect(blobs.get).not.toHaveBeenCalled();
  expect(blobs.put).not.toHaveBeenCalled();
  vi.mocked(store.get).mockResolvedValue({
    ...old,
    deletedAt: "2026-10-13T00:00:00Z",
  });
  await expect(service.setPolicy(actor, old.id, 1, policy)).rejects.toThrow(
    "NOT_FOUND",
  );
});
function fixture() {
  const old: LibraryFile = {
    id: "file",
    workspaceId: "workspace",
    spaceId: null,
    parentDocumentId: null,
    name: "Original.bin",
    originalName: "Original.bin",
    extension: "bin",
    mime: "application/octet-stream",
    size: 3,
    contentHash: "a".repeat(64),
    blobId: "a".repeat(64),
    version: 1,
    provenance: "HUMAN",
    aiPolicy: {
      classification: "SENSITIVE",
      processingBoundary: "LOCAL_ONLY",
      aiAccess: "DENY",
    },
    extractionStatus: "NOT_APPLICABLE",
    indexStatus: "PENDING",
    createdBy: "owner",
    updatedBy: "owner",
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
    deletedAt: null,
  };
  const store: LibraryFileStore = {
    get: vi.fn(async () => old),
    list: vi.fn(async () => [old]),
    save: vi.fn(async () => {}),
  };
  const blobs = {
    digest: vi.fn(async () => "b".repeat(64)),
    put: vi.fn(async () => {}),
    get: vi.fn<LocalBlobStore["get"]>(
      async () => new Blob([new Uint8Array([0, 128, 255])]),
    ),
  } satisfies LocalBlobStore;
  const service = new FileService(
    store,
    { listMetadata: async () => [] },
    blobs,
    {
      require: async (context) => {
        if (
          context.workspaceId !== actor.workspaceId ||
          context.principalId !== actor.principalId
        )
          throw new DomainError("FORBIDDEN");
      },
    },
    { now: () => "2026-10-13T00:00:00Z" },
    { next: () => "new-file" },
    16,
  );
  return { service, store, blobs, old };
}

it("stable File creation authorizes before private reads and rejects reused live/deleted identities", async () => {
  const { service, store, blobs, old } = fixture();
  const input = { name: "Source.txt", mime: "text/plain", spaceId: null },
    bytes = new Blob(["hi"]);
  await expect(
    service.uploadWithStableId(
      { ...actor, principalId: "foreign" },
      stableFileId,
      input,
      bytes,
    ),
  ).rejects.toThrow("FORBIDDEN");
  expect(store.get).not.toHaveBeenCalled();
  for (const deletedAt of [null, "2026-10-13T00:00:00Z"]) {
    vi.mocked(store.get).mockResolvedValue({
      ...old,
      id: stableFileId,
      deletedAt,
    });
    await expect(
      service.uploadWithStableId(actor, stableFileId, input, bytes),
    ).rejects.toThrow("VERSION_CONFLICT");
  }
  expect(blobs.digest).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
  vi.mocked(store.get).mockRejectedValue(new DomainError("NOT_FOUND"));
  vi.mocked(blobs.get).mockResolvedValue(null);
  const result = await service.uploadWithStableId(
    actor,
    stableFileId,
    input,
    bytes,
  );
  expect(result).toMatchObject({
    id: stableFileId,
    version: 1,
    originalName: input.name,
    size: bytes.size,
  });
  expect(store.save).toHaveBeenCalledWith(result, 0);
});
it("checks actor, name, size and location before storing any binary or metadata", async () => {
  const { service, blobs, store } = fixture();
  const input = { name: "Source.txt", mime: "text/plain", spaceId: null };
  await expect(
    service.upload(
      { ...actor, principalId: "foreign" },
      input,
      new Blob(["hi"]),
    ),
  ).rejects.toThrow("FORBIDDEN");
  await expect(
    service.upload(actor, { ...input, name: "../secret" }, new Blob(["hi"])),
  ).rejects.toThrow("VALIDATION_ERROR");
  await expect(
    service.upload(actor, input, new Blob(["x".repeat(17)])),
  ).rejects.toThrow("VALIDATION_ERROR");
  await expect(
    service.upload(
      actor,
      { ...input, spaceId: "foreign-space" },
      new Blob(["hi"]),
    ),
  ).rejects.toThrow("NOT_FOUND");
  expect(blobs.digest).not.toHaveBeenCalled();
  expect(blobs.put).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});

it("creates private metadata only after binary persistence and does not expose false extraction success", async () => {
  const { service, blobs, store } = fixture();
  vi.mocked(blobs.get).mockResolvedValue(null);
  vi.mocked(blobs.put).mockRejectedValueOnce(new Error("DISK_FULL"));
  const input = { name: "Source.pdf", mime: "application/pdf", spaceId: null };
  await expect(service.upload(actor, input, new Blob(["pdf"]))).rejects.toThrow(
    "DISK_FULL",
  );
  expect(store.save).not.toHaveBeenCalled();
  const file = await service.upload(actor, input, new Blob(["pdf"]));
  expect(file).toMatchObject({
    originalName: "Source.pdf",
    version: 1,
    size: 3,
    extractionStatus: "PENDING",
    indexStatus: "PENDING",
    aiPolicy: {
      classification: "PRIVATE",
      processingBoundary: "LOCAL_ONLY",
      aiAccess: "DENY",
    },
  });
  expect(file).not.toHaveProperty("base64");
  expect(store.save).toHaveBeenCalledWith(file, 0);
});

it("reuses verified workspace-scoped original bytes without inheriting another File's MIME or policy", async () => {
  const { service, blobs, store } = fixture();
  const bytes = new Blob(["pdf"]);
  vi.mocked(blobs.get).mockResolvedValue(bytes);
  const pdf = await service.upload(
    actor,
    { name: "A.pdf", mime: "application/pdf", spaceId: null },
    bytes,
  );
  const binary = await service.upload(
    actor,
    { name: "A.bin", mime: "application/octet-stream", spaceId: null },
    bytes,
  );
  expect(blobs.get).toHaveBeenCalledWith(actor.workspaceId, pdf.contentHash);
  expect(blobs.put).not.toHaveBeenCalled();
  expect(store.save).toHaveBeenCalledTimes(2);
  expect(binary.contentHash).toBe(pdf.contentHash);
  expect(binary.mime).toBe("application/octet-stream");
  expect(binary.originalName).toBe("A.bin");
  expect(binary.aiPolicy.aiAccess).toBe("DENY");
  expect(pdf.mime).toBe("application/pdf");
});

it("rejects corrupt completed content before creating duplicate metadata", async () => {
  const { service, blobs, store } = fixture();
  vi.mocked(blobs.digest)
    .mockResolvedValueOnce("b".repeat(64))
    .mockResolvedValueOnce("c".repeat(64));
  await expect(
    service.upload(
      actor,
      { name: "A.bin", mime: "application/octet-stream", spaceId: null },
      new Blob([new Uint8Array([0, 128, 255])]),
    ),
  ).rejects.toThrow("FILE_BLOB_MISSING_OR_CORRUPT");
  expect(blobs.put).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});

it("rename preserves original identity and policy and stale edits cannot overwrite metadata", async () => {
  const { service, old, store } = fixture();
  await expect(service.rename(actor, old.id, 0, "Wrong.txt")).rejects.toThrow(
    "VERSION_CONFLICT",
  );
  expect(store.save).not.toHaveBeenCalled();
  const renamed = await service.rename(actor, old.id, 1, "Display.txt");
  expect(renamed).toMatchObject({
    name: "Display.txt",
    originalName: old.originalName,
    extension: "bin",
    contentHash: old.contentHash,
    blobId: old.blobId,
    size: old.size,
    mime: old.mime,
    provenance: old.provenance,
    createdAt: old.createdAt,
    aiPolicy: old.aiPolicy,
    version: 2,
  });
});

it("deleted or corrupt original bytes cannot be exposed as successful downloads", async () => {
  const { service, old, store, blobs } = fixture();
  vi.mocked(store.get).mockResolvedValueOnce({
    ...old,
    deletedAt: "2026-10-13T00:00:00Z",
  });
  await expect(service.originalBytes(actor, old.id)).rejects.toThrow(
    "NOT_FOUND",
  );
  expect(blobs.get).not.toHaveBeenCalled();
  vi.mocked(blobs.get).mockResolvedValueOnce(new Blob(["wrong"]));
  await expect(service.originalBytes(actor, old.id)).rejects.toThrow(
    "FILE_BLOB_MISSING_OR_CORRUPT",
  );
  vi.mocked(blobs.digest).mockResolvedValueOnce("f".repeat(64));
  await expect(service.originalBytes(actor, old.id)).rejects.toThrow(
    "FILE_BLOB_MISSING_OR_CORRUPT",
  );
  vi.mocked(blobs.digest).mockResolvedValue(old.contentHash);
  expect([
    ...new Uint8Array(
      await (await service.originalBytes(actor, old.id)).arrayBuffer(),
    ),
  ]).toEqual([0, 128, 255]);
});
