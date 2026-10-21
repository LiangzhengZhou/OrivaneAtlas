import { createHash } from "node:crypto";
import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each([
  { continuous: false, document: false },
  { continuous: true, document: false },
  { continuous: false, document: true },
  { continuous: true, document: true },
])(
  "durable read restarts only an invalidated snapshot ($document, $continuous)",
  async ({ continuous, document }) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open(
      "workspace-read-contention",
      factory,
    );
    const second = await IndexedDbLocalStore.open(
      "workspace-read-contention",
      factory,
    );
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const blobs = {
      get: async () => null,
      put: async () => {},
      sha256: async (blob: Blob) =>
        createHash("sha256")
          .update(Buffer.from(await blob.arrayBuffer()))
          .digest("hex"),
    };
    const wiki = { extract: () => [], resolve: () => [] };
    const clock = { now: () => "2026-10-19T00:00:00Z" };
    const ids = { next: () => crypto.randomUUID() };
    const other = new LocalRuntime(
      new LocalWorkspace(second.metadata, blobs, identity, wiki, clock, ids),
    );
    let armed = false,
      writes = 0;
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        {
          ...first.metadata,
          list: async (workspaceId, collection) => {
            const rows = await first.metadata.list(workspaceId, collection);
            if (armed && collection === "items") {
              armed = continuous;
              writes++;
              await other.service.create(other.context, {
                title: `Concurrent project${writes}`,
                type: "PROJECT",
              });
            }
            return rows;
          },
          get: async (workspaceId, collection, id) => {
            const row = await first.metadata.get(workspaceId, collection, id);
            if (armed && document && collection === "notes") {
              armed = continuous;
              writes++;
              await other.service.create(other.context, {
                title: `Concurrent project${writes}`,
                type: "PROJECT",
              });
            }
            return row;
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
      const initial = await runtime.service.create(runtime.context, {
        title: "Existing project",
        type: "PROJECT",
      });
      const note = document
        ? await runtime.saveNote(null, 0, {
            kind: "NOTE",
            title: "Original",
            bodyMd: "Exact Markdown\n",
            day: null,
          })
        : null;
      armed = true;
      const reading = note
        ? runtime.readDocumentBody(note)
        : runtime.loadWorkspace();
      if (continuous)
        await expect(reading).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      else if (note)
        await expect(reading).resolves.toMatchObject({
          version: 1,
          bodyMd: note.bodyMd,
        });
      else {
        const snapshot = await reading;
        if (!("items" in snapshot)) throw new Error("EXPECTED_WORKSPACE");
        expect(snapshot.items.map((item) => item.title).sort()).toEqual([
          "Concurrent project1",
          "Existing project",
        ]);
      }
      expect(writes).toBe(continuous ? 3 : 1);
      expect(await first.outbox.list(identity.workspaceId)).toHaveLength(
        writes + (note ? 2 : 1),
      );
      expect(
        (await first.metadata.get(identity.workspaceId, "items", initial.id))
          ?.version,
      ).toBe(1);
    } finally {
      first.close();
      second.close();
    }
  },
);
