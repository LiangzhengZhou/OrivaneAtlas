import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  type LocalFileBinaryTransport,
  syncVerifiedLocalFileBinary,
} from "./local-file-binary-sync";
import type { LocalBlobStore, LocalSyncState } from "./local-persistence";

const actor = { workspaceId: "source", principalId: "local-owner" };
const binding: LocalSyncState = {
  workspaceId: "source",
  remoteWorkspaceId: "chosen-destination",
  remotePrincipalId: "remote-owner",
  serverOrigin: "https://example.test",
  epoch: "e",
  cursor: 4,
  version: 1,
};
const digest = async (bytes: Blob) =>
  createHash("sha256")
    .update(Buffer.from(await bytes.arrayBuffer()))
    .digest("hex");
const bytes = new Blob([new Uint8Array(600001).map((_, index) => index % 251)]);
const blobs: LocalBlobStore = {
  digest,
  get: async (workspaceId) =>
    workspaceId === actor.workspaceId ? bytes : null,
  put: async () => {
    throw new Error("MUST_NOT_REWRITE_SOURCE");
  },
};

test("shared import transfer resumes verified original chunks only in the captured destination", async () => {
  const hash = await digest(bytes),
    received = new Map<number, Blob>(),
    sent: number[] = [];
  let interrupted = false;
  const transport: LocalFileBinaryTransport = {
    begin: async (scope, input) => {
      expect(scope.remoteWorkspaceId).toBe("chosen-destination");
      expect(input.contentHash).toBe(hash);
      return { contentHash: hash, received: [...received.keys()] };
    },
    putChunk: async (scope, contentHash, index, chunkHash, chunk) => {
      expect(scope.remoteWorkspaceId).toBe("chosen-destination");
      expect(contentHash).toBe(hash);
      expect(await digest(chunk)).toBe(chunkHash);
      sent.push(index);
      received.set(index, chunk);
      if (!interrupted) {
        interrupted = true;
        throw new Error("NETWORK_INTERRUPTED");
      }
      return { contentHash, index };
    },
    complete: async (_scope, contentHash) => {
      const restored = new Blob(
        [...received.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, chunk]) => chunk),
      );
      expect(await digest(restored)).toBe(hash);
      expect(restored.size).toBe(bytes.size);
      return { contentHash, complete: true };
    },
  };
  const input = {
    contentHash: hash,
    size: bytes.size,
    mime: "application/octet-stream",
  };
  await expect(
    syncVerifiedLocalFileBinary(
      actor,
      input,
      blobs,
      transport,
      async () => binding,
    ),
  ).rejects.toThrow("NETWORK_INTERRUPTED");
  await syncVerifiedLocalFileBinary(
    actor,
    input,
    blobs,
    transport,
    async () => binding,
  );
  expect(sent).toEqual([0, 1, 2]);
});

test("missing/corrupt originals or changed destination fail without uploading later chunks", async () => {
  const hash = await digest(bytes),
    begin = vi.fn(async () => ({ contentHash: hash, received: [] })),
    putChunk = vi.fn(),
    complete = vi.fn();
  const transport = { begin, putChunk, complete },
    input = {
      contentHash: hash,
      size: bytes.size,
      mime: "application/octet-stream",
    };
  await expect(
    syncVerifiedLocalFileBinary(
      actor,
      input,
      { ...blobs, get: async () => new Blob(["wrong bytes"]) },
      transport,
      async () => binding,
    ),
  ).rejects.toThrow("LOCAL_FILE_BYTES_MISSING_OR_CORRUPT");
  expect(begin).not.toHaveBeenCalled();
  let scopeChecks = 0;
  await expect(
    syncVerifiedLocalFileBinary(actor, input, blobs, transport, async () =>
      ++scopeChecks < 3
        ? binding
        : { ...binding, remoteWorkspaceId: "foreign" },
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  expect(begin).toHaveBeenCalledOnce();
  expect(putChunk).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});
