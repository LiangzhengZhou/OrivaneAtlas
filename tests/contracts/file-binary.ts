import { expect, test } from "vitest";
import type { LocalChunkBlobStore } from "../../packages/application/src/local-persistence";

export function fileBinaryContract(
  name: string,
  create: () => Promise<{
    run<T>(
      workspaceId: string,
      action: (store: LocalChunkBlobStore) => Promise<T>,
    ): Promise<T>;
  }>,
) {
  test(`${name} binary chunks resume, deduplicate and become readable only after whole-content verification`, async () => {
    const fixture = await create(),
      workspace = "workspace-a";
    const bytes = new Blob([new Uint8Array([0, 1, 127, 128, 255])]);
    const hash = await fixture.run(workspace, async (store) => {
      const hash = await store.digest!(bytes);
      await store.begin({
        workspaceId: workspace,
        sha256: hash,
        size: bytes.size,
        mime: "application/octet-stream",
        chunkSize: 2,
      });
      return hash;
    });
    await fixture.run(workspace, async (store) => {
      const first = bytes.slice(0, 2),
        chunkHash = await store.digest!(first);
      await store.putChunk(workspace, hash, 0, chunkHash, first);
      await store.putChunk(workspace, hash, 0, chunkHash, first);
      expect(await store.chunks(workspace, hash)).toEqual([0]);
      expect(await store.get(workspace, hash)).toBeNull();
    });
    await expect(
      fixture.run(workspace, (store) => store.complete(workspace, hash)),
    ).rejects.toThrow("FILE_UPLOAD_INCOMPLETE");
    await expect(
      fixture.run(workspace, (store) => store.get("workspace-b", hash)),
    ).rejects.toThrow("FORBIDDEN");
    await fixture.run(workspace, async (store) => {
      expect(await store.chunks(workspace, hash)).toEqual([0]);
      for (let index = 1; index < 3; index++) {
        const chunk = bytes.slice(index * 2, (index + 1) * 2);
        await store.putChunk(
          workspace,
          hash,
          index,
          await store.digest!(chunk),
          chunk,
        );
      }
      await store.complete(workspace, hash);
    });
    const original = await fixture.run(workspace, async (store) => {
      const original = await store.get(workspace, hash);
      if (!original) throw new Error("COMPLETED_FILE_NOT_READABLE");
      return [...new Uint8Array(await original.arrayBuffer())];
    });
    expect(original).toEqual([0, 1, 127, 128, 255]);
    await expect(
      fixture.run(workspace, async (store) => {
        const wrong = new Blob([new Uint8Array([2, 3])]);
        await store.putChunk(
          workspace,
          hash,
          0,
          await store.digest!(wrong),
          wrong,
        );
      }),
    ).rejects.toThrow("FILE_HASH_MISMATCH");
    expect(
      await fixture.run("workspace-b", (store) =>
        store.get("workspace-b", hash),
      ),
    ).toBeNull();
    const wrongWholeHash = "a".repeat(64);
    await fixture.run(workspace, (store) =>
      store.begin({
        workspaceId: workspace,
        sha256: wrongWholeHash,
        size: 5,
        mime: "application/octet-stream",
        chunkSize: 5,
      }),
    );
    await expect(
      fixture.run(workspace, async (store) => {
        await store.putChunk(
          workspace,
          wrongWholeHash,
          0,
          await store.digest!(bytes),
          bytes,
        );
        await store.complete(workspace, wrongWholeHash);
      }),
    ).rejects.toThrow("FILE_HASH_MISMATCH");
    await fixture.run(workspace, async (store) => {
      expect(await store.get(workspace, wrongWholeHash)).toBeNull();
      expect(await store.chunks(workspace, wrongWholeHash)).toEqual([]);
      await expect(
        store.putChunk(workspace, wrongWholeHash, 0, "b".repeat(64), bytes),
      ).rejects.toThrow("FILE_HASH_MISMATCH");
    });
    let escaped: LocalChunkBlobStore | undefined;
    await fixture.run(workspace, async (store) => {
      escaped = store;
    });
    if (!escaped) throw new Error("MISSING_BINARY_PORT");
    await expect(escaped.get(workspace, hash)).rejects.toThrow(
      "TRANSACTION_CLOSED",
    );
  });
}
