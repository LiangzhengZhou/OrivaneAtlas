import { createHash } from "node:crypto";
import {
  FileProjectLinkError,
  LocalRuntime,
  LocalWorkspace,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(
  [false, true].flatMap((legacy) =>
    ([null, "files", "links"] as const).map((failCommit) => ({
      legacy,
      failCommit,
    })),
  ),
)(
  "Project File durable commands, legacy=$legacy, storage failure=$failCommit",
  async ({ legacy, failCommit }) => {
    const factory = new IDBFactory();
    const store = await IndexedDbLocalStore.open("project-file", factory);
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
      digest: async (blob: Blob) =>
        createHash("sha256")
          .update(Buffer.from(await blob.arrayBuffer()))
          .digest("hex"),
    };
    const wiki = { extract: () => [], resolve: () => [] };
    const clock = { now: () => "2026-10-19T00:00:00Z" };
    const ids = { next: () => crypto.randomUUID() };
    let armed = false;
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        {
          ...store.metadata,
          commit: async (...args) => {
            if (
              armed &&
              args[2].some((write) => write.entity.collection === failCommit)
            )
              throw new Error("PROJECT_FILE_STORAGE_FAILURE");
            return store.metadata.commit(...args);
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
      const project = await runtime.service.create(runtime.context, {
        title: "Local Project",
        type: "PROJECT",
      });
      const bytes = new Blob([new Uint8Array([0, 128, 255, 10])]);
      const input = {
        name: "Original.bin",
        mime: "application/octet-stream",
        spaceId: null,
      };
      const legacyId = crypto.randomUUID();
      if (legacy) {
        // Seed an existing pre-v3 metadata record; this is not a product write.
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = factory.open("project-file");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("entities", "readwrite");
            tx.objectStore("entities").put({
              workspaceId: identity.workspaceId,
              collection: "projectMaterials",
              id: legacyId,
              version: 1,
              value: {
                id: legacyId,
                workspaceId: identity.workspaceId,
                projectId: project.id,
                kind: "FILE",
                ownership: "OWNED",
                targetId: null,
                title: input.name,
                mime: input.mime,
                size: bytes.size,
                version: 1,
                updatedBy: identity.principalId,
                updatedAt: clock.now(),
                deletedAt: null,
              },
            });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      }
      const upload = () =>
        legacy
          ? runtime.importLegacyProjectFile(legacyId, 1, bytes)
          : runtime.uploadProjectFile(project.id, input, bytes);
      armed = failCommit !== null;
      if (failCommit === "files") {
        await expect(upload()).rejects.toThrow("PROJECT_FILE_STORAGE_FAILURE");
        expect(
          await store.metadata.list(identity.workspaceId, "files"),
        ).toHaveLength(0);
        expect(
          await store.metadata.list(identity.workspaceId, "links"),
        ).toHaveLength(0);
        expect(await store.outbox.list(identity.workspaceId)).toHaveLength(1);
      } else {
        let file;
        if (failCommit === "links") {
          const failure = await upload().then(
            () => {
              throw new Error("Expected relationship failure");
            },
            (error: unknown) => error,
          );
          expect(failure).toBeInstanceOf(FileProjectLinkError);
          if (!(failure instanceof FileProjectLinkError)) throw failure;
          file = failure.file;
          expect(
            await store.metadata.list(identity.workspaceId, "files"),
          ).toHaveLength(1);
          expect(
            await store.metadata.list(identity.workspaceId, "links"),
          ).toHaveLength(0);
          expect(await store.outbox.list(identity.workspaceId)).toHaveLength(2);
        } else {
          file = await upload();
        }
        expect(file.contentHash).toBe(await blobs.digest(bytes));
        if (legacy) expect(file.id).toBe(legacyId);
        store.close();
        const reopened = await IndexedDbLocalStore.open(
          "project-file",
          factory,
        );
        try {
          const restarted = new LocalRuntime(
            new LocalWorkspace(
              reopened.metadata,
              blobs,
              identity,
              wiki,
              clock,
              ids,
            ),
          );
          if (failCommit === "links") {
            await restarted.link(
              { kind: "WORK", id: project.id },
              { kind: "FILE", id: file.id },
              "REFERENCES",
            );
          }
          const snapshot = await restarted.loadWorkspace();
          expect(snapshot.files).toHaveLength(1);
          expect(snapshot.links).toEqual([
            expect.objectContaining({
              from: { kind: "WORK", id: project.id },
              to: { kind: "FILE", id: file.id },
              relation: "REFERENCES",
            }),
          ]);
          expect(
            snapshot.projectMaterials.filter(
              (material) => material.kind === "FILE",
            ),
          ).toHaveLength(legacy ? 1 : 0);
          expect(
            new Uint8Array(
              await (await restarted.readFileBytes(file.id)).arrayBuffer(),
            ),
          ).toEqual(new Uint8Array([0, 128, 255, 10]));
          expect(await reopened.outbox.list(identity.workspaceId)).toHaveLength(
            3,
          );
        } finally {
          reopened.close();
        }
      }
    } finally {
      store.close();
    }
  },
);
