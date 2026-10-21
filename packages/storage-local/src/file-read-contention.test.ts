import { createHash } from "node:crypto";
import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["UNRELATED", "DELETED", "CONTINUOUS"])(
  "File read revalidates a concurrent change (%s)",
  async (mode) => {
    const deleted = mode === "DELETED";
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open(
      "file-read-contention",
      factory,
    );
    const second = await IndexedDbLocalStore.open(
      "file-read-contention",
      factory,
    );
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const content = new Map<string, Blob>();
    let interfere: (() => Promise<void>) | null = null;
    const blobs = {
      get: async (_workspace: string, hash: string) => {
        const callback = interfere;
        interfere = null;
        if (callback) await callback();
        return content.get(hash) ?? null;
      },
      put: async (_workspace: string, hash: string, bytes: Blob) => {
        content.set(hash, bytes);
      },
      digest: async (bytes: Blob) =>
        createHash("sha256")
          .update(new Uint8Array(await bytes.arrayBuffer()))
          .digest("hex"),
    };
    const wiki = { extract: () => [], resolve: () => [] };
    const clock = { now: () => "2026-10-16T00:00:00.000Z" };
    const ids = { next: () => crypto.randomUUID() };
    const runtime = new LocalRuntime(
      new LocalWorkspace(first.metadata, blobs, identity, wiki, clock, ids),
    );
    const other = new LocalRuntime(
      new LocalWorkspace(second.metadata, blobs, identity, wiki, clock, ids),
    );
    try {
      const original = new Blob([new Uint8Array([0, 128, 255])]);
      const file = await runtime.uploadFile(
        {
          name: "original.bin",
          mime: "application/octet-stream",
          spaceId: null,
        },
        original,
      );
      const change = async () => {
        if (deleted) await other.deleteFile(file.id, file.version, true);
        else
          await other.service.create(other.context, {
            title: "Unrelated",
            type: "TASK",
          });
        if (mode === "CONTINUOUS") interfere = change;
      };
      interfere = change;
      if (mode === "CONTINUOUS")
        await expect(runtime.readFileBytes(file.id)).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      else if (deleted)
        await expect(runtime.readFileBytes(file.id)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      else
        expect(
          new Uint8Array(
            await (await runtime.readFileBytes(file.id)).arrayBuffer(),
          ),
        ).toEqual(new Uint8Array([0, 128, 255]));
      expect(await first.outbox.list(identity.workspaceId)).toHaveLength(
        mode === "CONTINUOUS" ? 4 : 2,
      );
      expect(
        (await first.metadata.get(identity.workspaceId, "files", file.id))
          ?.version,
      ).toBe(deleted ? 2 : 1);
    } finally {
      first.close();
      second.close();
    }
  },
);
