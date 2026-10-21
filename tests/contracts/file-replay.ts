import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { FileReplayEffects } from "../../packages/application/src/file-replay-effects";
import { FileTransferService } from "../../packages/application/src/file-transfer";
import {
  FileService,
  type LibraryFileStore,
} from "../../packages/application/src/files";
import type { LibraryStore } from "../../packages/application/src/library";
import type { LocalChunkBlobStore } from "../../packages/application/src/local-persistence";

export async function fileReplayScenario(
  run: <T>(
    operation: (
      files: LibraryFileStore,
      library: LibraryStore,
      blobs: LocalChunkBlobStore,
    ) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = { require: async () => {} },
    clock = { now: () => "2026-10-14T00:00:00Z" },
    ids = { next: randomUUID },
    id = randomUUID(),
    bytes = new Blob([new Uint8Array([0, 1, 127, 128, 255])]);
  const hash = await run(async (_files, _library, blobs) =>
    blobs.digest!(bytes),
  );
  await run(async (files, library, blobs) => {
    const transfer = new FileTransferService(blobs, auth);
    expect(
      await transfer.begin(actor, {
        contentHash: hash,
        size: bytes.size,
        mime: "application/octet-stream",
        chunkSize: 2,
      }),
    ).toEqual({ contentHash: hash, received: [] });
    const first = bytes.slice(0, 2),
      firstHash = await blobs.digest!(first);
    await transfer.putChunk(actor, hash, 0, firstHash, first);
    await transfer.putChunk(actor, hash, 0, firstHash, first);
    await expect(
      new FileService(files, library, blobs, auth, clock, ids).registerUploaded(
        actor,
        id,
        { name: "原始.bin", mime: "application/octet-stream", spaceId: null },
        hash,
        bytes.size,
      ),
    ).rejects.toThrow("NOT_FOUND");
    expect(await files.list()).toEqual([]);
  });
  await run(async (_files, _library, blobs) => {
    const transfer = new FileTransferService(blobs, auth);
    expect(await transfer.status(actor, hash)).toEqual({
      contentHash: hash,
      received: [0],
    });
    for (let i = 1; i < 3; i++) {
      const chunk = bytes.slice(i * 2, (i + 1) * 2);
      await transfer.putChunk(
        actor,
        hash,
        i,
        await blobs.digest!(chunk),
        chunk,
      );
    }
    expect(await transfer.complete(actor, hash)).toEqual({
      contentHash: hash,
      complete: true,
    });
  });
  const create = () =>
    run(async (files, library, blobs) => {
      const guard = new FileReplayEffects(
        actor.workspaceId,
        actor.principalId,
        [{ collection: "files", id, op: "UPSERT", baseVersion: 0 }],
      );
      const result = await guard.run(files, (store) =>
        new FileService(
          store,
          library,
          blobs,
          auth,
          clock,
          ids,
        ).registerUploaded(
          actor,
          id,
          { name: "原始.bin", mime: "application/octet-stream", spaceId: null },
          hash,
          bytes.size,
        ),
      );
      expect(guard.acceptedEffects).toEqual([
        { collection: "files", id, op: "UPSERT", version: 1, value: result },
      ]);
      return result;
    });
  const original = await create();
  await expect(create()).rejects.toThrow("VERSION_CONFLICT");
  await expect(
    run(async (files, library, blobs) => {
      const guard = new FileReplayEffects(
        actor.workspaceId,
        actor.principalId,
        [{ collection: "files", id, op: "UPSERT", baseVersion: 1 }],
      );
      await guard.run(files, async (store) => {
        const service = new FileService(
          store,
          library,
          blobs,
          auth,
          clock,
          ids,
        );
        const renamed = await service.rename(actor, id, 1, "Display.txt");
        await service.setDeleted(actor, id, renamed.version, true);
      });
    }),
  ).rejects.toThrow("VERSION_CONFLICT");
  await run(async (files) => {
    expect(await files.get(id)).toEqual(original);
  });
  for (const [version, deleted] of [
    [1, false],
    [2, true],
    [3, false],
  ] as const) {
    await run(async (files, library, blobs) => {
      const guard = new FileReplayEffects(
        actor.workspaceId,
        actor.principalId,
        [{ collection: "files", id, op: "UPSERT", baseVersion: version }],
      );
      const result = await guard.run(files, (store) => {
        const service = new FileService(
          store,
          library,
          blobs,
          auth,
          clock,
          ids,
        );
        return version === 1
          ? service.rename(actor, id, version, "Display.txt")
          : service.setDeleted(actor, id, version, deleted);
      });
      expect(guard.acceptedEffects[0]?.value).toEqual(result);
      expect(result).toMatchObject({
        id,
        name: "Display.txt",
        originalName: original.originalName,
        contentHash: original.contentHash,
        blobId: original.blobId,
        extension: original.extension,
        version: version + 1,
      });
      expect(Boolean(result.deletedAt)).toBe(deleted);
    });
  }
  await run(async (files, library, blobs) => {
    const originalBytes = await new FileService(
      files,
      library,
      blobs,
      auth,
      clock,
      ids,
    ).originalBytes(actor, id);
    expect(new Uint8Array(await originalBytes.arrayBuffer())).toEqual(
      new Uint8Array(await bytes.arrayBuffer()),
    );
    expect(await files.list()).toHaveLength(1);
  });
}
