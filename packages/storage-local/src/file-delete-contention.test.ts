import { createHash } from "node:crypto";
import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["once", "continuous", "entity", "storage"] as const)(
  "File delete/restore retains CAS and atomic outbox during %s contention",
  async (mode) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open("file-contention", factory);
    const second = await IndexedDbLocalStore.open("file-contention", factory);
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const content = new Map<string, Blob>();
    const blobs = {
      get: async (_workspace: string, hash: string) =>
        content.get(hash) ?? null,
      put: async (_workspace: string, hash: string, bytes: Blob) => {
        content.set(hash, bytes);
      },
      digest: async (bytes: Blob) =>
        createHash("sha256")
          .update(Buffer.from(await bytes.arrayBuffer()))
          .digest("hex"),
    };
    const wiki = { extract: () => [], resolve: () => [] };
    const clock = { now: () => "2026-10-23T00:00:00Z" };
    const ids = { next: () => crypto.randomUUID() };
    const other = new LocalRuntime(
      new LocalWorkspace(second.metadata, blobs, identity, wiki, clock, ids),
    );
    let armed = false,
      collisions = 0;
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        {
          ...first.metadata,
          commit: async (...args) => {
            if (armed) {
              armed = false;
              collisions++;
              if (mode === "storage") throw new Error("DISK_FAILURE");
              if (mode === "entity") {
                const write = args[2].find(
                  (write) => write.entity.collection === "files",
                )!;
                await other.deleteFile(
                  write.entity.id,
                  write.expectedVersion!,
                  true,
                );
              } else {
                await other.saveNote(null, 0, {
                  title: "Concurrent ACK-equivalent revision",
                  bodyMd: "Preserved",
                  kind: "NOTE",
                  day: null,
                });
              }
              if (mode === "continuous") armed = true;
            }
            return first.metadata.commit(...args);
          },
        },
        blobs,
        identity,
        wiki,
        clock,
        ids,
      ),
    );
    try {
      const bytes = new Blob([new Uint8Array([0, 128, 255, 10])]);
      const file = await runtime.uploadFile(
        {
          name: "original.bin",
          mime: "application/octet-stream",
          spaceId: null,
        },
        bytes,
      );
      const before = await first.outbox.list(identity.workspaceId);
      armed = true;
      const deleting = runtime.deleteFile(file.id, file.version, true);
      if (mode === "once") {
        const deleted = await deleting;
        expect(deleted).toMatchObject({
          id: file.id,
          version: 2,
          deletedAt: clock.now(),
        });
        expect(collisions).toBe(1);
        const outbox = await first.outbox.list(identity.workspaceId);
        expect(outbox.filter((row) => row.entityType === "files")).toHaveLength(
          2,
        );
        expect(outbox.filter((row) => row.entityType === "notes")).toHaveLength(
          1,
        );
        armed = true;
        const restored = await runtime.deleteFile(
          file.id,
          deleted.version,
          false,
        );
        expect(restored).toMatchObject({
          id: file.id,
          version: 3,
          deletedAt: null,
        });
        expect(collisions).toBe(2);
        await expect(
          runtime.deleteFile(file.id, file.version, true),
        ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
        expect(
          new Uint8Array(
            await (await runtime.readFileBytes(file.id)).arrayBuffer(),
          ),
        ).toEqual(new Uint8Array(await bytes.arrayBuffer()));
      } else {
        await expect(deleting).rejects.toMatchObject(
          mode === "storage"
            ? { message: "DISK_FAILURE" }
            : { code: "VERSION_CONFLICT" },
        );
        expect(collisions).toBe(mode === "continuous" ? 3 : 1);
        const outbox = await first.outbox.list(identity.workspaceId);
        expect(outbox.filter((row) => row.entityType === "files")).toHaveLength(
          mode === "entity" ? 2 : 1,
        );
        expect(outbox.slice(0, before.length)).toEqual(before);
        const current = await first.metadata.get(
          identity.workspaceId,
          "files",
          file.id,
        );
        expect(current?.version).toBe(mode === "entity" ? 2 : 1);
      }
    } finally {
      first.close();
      second.close();
    }
  },
);
