import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  FileService,
  type LibraryFileStore,
} from "../../packages/application/src/files";
import type { LibraryStore } from "../../packages/application/src/library";
import type { LocalChunkBlobStore } from "../../packages/application/src/local-persistence";

export function fileServiceBinaryContract(
  name: string,
  create: () => Promise<{
    run<T>(
      action: (
        files: LibraryFileStore,
        library: LibraryStore,
        blobs: LocalChunkBlobStore,
      ) => Promise<T>,
    ): Promise<T>;
  }>,
) {
  test(`${name} FileService wires actual binary ports, reuses bytes and rolls back metadata and bytes together`, async () => {
    const fixture = await create(),
      actor = { workspaceId: "workspace-a", principalId: "human" };
    const service = (
      files: LibraryFileStore,
      library: LibraryStore,
      blobs: LocalChunkBlobStore,
    ) =>
      new FileService(
        files,
        library,
        blobs,
        {
          require: async (context) => {
            if (
              context.workspaceId !== actor.workspaceId ||
              context.principalId !== actor.principalId
            )
              throw new Error("FORBIDDEN");
          },
        },
        { now: () => "2026-10-13T00:00:00Z" },
        { next: randomUUID },
      );
    const bytes = new Blob([new Uint8Array([0, 128, 255])]);
    const first = await fixture.run((files, library, blobs) =>
      service(files, library, blobs).upload(
        actor,
        { name: "Original.txt", mime: "text/plain", spaceId: null },
        bytes,
      ),
    );
    const second = await fixture.run((files, library, blobs) =>
      service(files, library, blobs).upload(
        actor,
        {
          name: "Original.bin",
          mime: "application/octet-stream",
          spaceId: null,
        },
        bytes,
      ),
    );
    expect(second.id).not.toBe(first.id);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.mime).toBe("application/octet-stream");
    expect(second.aiPolicy.aiAccess).toBe("DENY");
    const snapshot = await fixture.run(async (files, library, blobs) => ({
      files: await files.list(),
      bytes: [
        ...new Uint8Array(
          await (
            await service(files, library, blobs).originalBytes(actor, second.id)
          ).arrayBuffer(),
        ),
      ],
    }));
    expect(snapshot.files).toHaveLength(2);
    expect(snapshot.bytes).toEqual([0, 128, 255]);
    const abandoned = new Blob([new Uint8Array([1, 2, 3, 4])]);
    let abandonedHash = "";
    await expect(
      fixture.run(async (files, library, blobs) => {
        const file = await service(files, library, blobs).upload(
          actor,
          {
            name: "Rollback.bin",
            mime: "application/octet-stream",
            spaceId: null,
          },
          abandoned,
        );
        abandonedHash = file.contentHash;
        throw new Error("AFTER_FILE_UPLOAD");
      }),
    ).rejects.toThrow("AFTER_FILE_UPLOAD");
    await fixture.run(async (files, _library, blobs) => {
      expect(await files.list()).toHaveLength(2);
      expect(await blobs.get(actor.workspaceId, abandonedHash)).toBeNull();
    });
  });
}
