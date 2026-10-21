import { DomainError } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import { FileTransferService } from "./file-transfer";
import type { LocalChunkBlobStore } from "./local-persistence";

function ports(): LocalChunkBlobStore {
  return {
    begin: vi.fn(async () => {}),
    chunks: vi.fn(async () => []),
    putChunk: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
  };
}
const actor = { workspaceId: "local", principalId: "owner" },
  hash = "a".repeat(64);
it("File transfer authorizes before private descriptor reads and binary writes", async () => {
  const blobs = ports(),
    service = new FileTransferService(blobs, {
      require: async () => {
        throw new DomainError("FORBIDDEN");
      },
    });
  await expect(
    service.begin(actor, {
      contentHash: hash,
      size: 5,
      mime: "text/plain",
      chunkSize: 2,
    }),
  ).rejects.toThrow("FORBIDDEN");
  await expect(service.status(actor, hash)).rejects.toThrow("FORBIDDEN");
  await expect(
    service.putChunk(actor, hash, 0, hash, new Blob(["x"])),
  ).rejects.toThrow("FORBIDDEN");
  await expect(service.complete(actor, hash)).rejects.toThrow("FORBIDDEN");
  for (const name of ["begin", "chunks", "putChunk", "complete"] as const)
    expect(blobs[name]).not.toHaveBeenCalled();
});
it("rejects oversized and malformed transfer input without touching binary ports", async () => {
  const blobs = ports(),
    service = new FileTransferService(blobs, { require: async () => {} });
  for (const invalid of [
    { contentHash: "wrong", size: 5, mime: "text/plain", chunkSize: 2 },
    {
      contentHash: hash,
      size: 100 * 1024 * 1024 + 1,
      mime: "text/plain",
      chunkSize: 2,
    },
    { contentHash: hash, size: 5, mime: "text/plain", chunkSize: 262145 },
  ])
    await expect(service.begin(actor, invalid)).rejects.toThrow(
      "VALIDATION_ERROR",
    );
  await expect(
    service.putChunk(actor, hash, 0, hash, new Blob([new Uint8Array(262145)])),
  ).rejects.toThrow("VALIDATION_ERROR");
  expect(blobs.begin).not.toHaveBeenCalled();
  expect(blobs.putChunk).not.toHaveBeenCalled();
});
it("detaches transfer metadata and actor before asynchronous authorization", async () => {
  const blobs = ports();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new FileTransferService(blobs, { require: async () => gate });
  const context = { ...actor },
    input = { contentHash: hash, size: 5, mime: "text/plain", chunkSize: 2 };
  const pending = service.begin(context, input);
  context.workspaceId = "foreign";
  input.size = 999;
  input.contentHash = "b".repeat(64);
  release();
  await expect(pending).resolves.toEqual({ contentHash: hash, received: [] });
  expect(blobs.begin).toHaveBeenCalledWith({
    workspaceId: actor.workspaceId,
    sha256: hash,
    size: 5,
    mime: "text/plain",
    chunkSize: 2,
  });
});
