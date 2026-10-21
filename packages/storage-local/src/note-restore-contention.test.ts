import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["UNRELATED", "SAME_NOTE", "CONTINUOUS"])(
  "note restore preserves entity CAS under %s contention",
  async (mode) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open(
      "note-restore-contention",
      factory,
    );
    const second = await IndexedDbLocalStore.open(
      "note-restore-contention",
      factory,
    );
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const clock = { now: () => "2026-10-19T00:00:00.000Z" };
    const ids = { next: () => crypto.randomUUID() };
    const blobs = {
      get: async () => null,
      put: async () => {
        throw new Error("unexpected Blob write");
      },
    };
    const wiki = { extract: () => [], resolve: () => [] };
    let interfere: (() => Promise<void>) | null = null;
    let attempts = 0;
    const other = new LocalRuntime(
      new LocalWorkspace(second.metadata, blobs, identity, wiki, clock, ids),
    );
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        {
          ...first.metadata,
          commit: async (...args) => {
            const callback = interfere;
            interfere = null;
            if (callback) {
              attempts++;
              await callback();
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
      const original = await runtime.saveNote(null, 0, {
        title: "Original",
        bodyMd: "Exact private Markdown\n",
        kind: "NOTE",
        day: null,
      });
      const deleted = await runtime.deleteNote(
        original.id,
        original.version,
        true,
      );
      const concurrent = async () => {
        if (mode === "SAME_NOTE")
          await other.deleteNote(deleted.id, deleted.version, false);
        else
          await other.service.create(other.context, {
            title: "Unrelated",
            type: "TASK",
          });
        if (mode === "CONTINUOUS") interfere = concurrent;
      };
      interfere = concurrent;
      const restoring = runtime.deleteNote(deleted.id, deleted.version, false);
      if (mode === "UNRELATED")
        await expect(restoring).resolves.toMatchObject({
          id: original.id,
          version: 3,
          deletedAt: null,
          bodyMd: original.bodyMd,
        });
      else
        await expect(restoring).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      const row = await first.metadata.get(
        identity.workspaceId,
        "notes",
        original.id,
      );
      expect(row?.version).toBe(mode === "CONTINUOUS" ? 2 : 3);
      expect(row?.value).toMatchObject({ title: original.title });
      expect(attempts).toBe(mode === "CONTINUOUS" ? 3 : 1);
      expect(await first.outbox.list(identity.workspaceId)).toHaveLength(
        mode === "CONTINUOUS" ? 5 : mode === "SAME_NOTE" ? 3 : 4,
      );
    } finally {
      first.close();
      second.close();
    }
  },
);
