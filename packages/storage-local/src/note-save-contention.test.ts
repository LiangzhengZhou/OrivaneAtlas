import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["UNRELATED", "SAME_NOTE", "CONTINUOUS"])(
  "Note save preserves original text and CAS under %s contention",
  async (mode) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open("note-contention", factory);
    const second = await IndexedDbLocalStore.open("note-contention", factory);
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const clock = { now: () => "2026-10-22T00:00:00Z" };
    const ids = { next: () => crypto.randomUUID() };
    const blobs = { get: async () => null, put: async () => {} };
    const wiki = { extract: () => [], resolve: () => [] };
    const other = new LocalRuntime(
      new LocalWorkspace(second.metadata, blobs, identity, wiki, clock, ids),
    );
    let interfere: (() => Promise<void>) | null = null;
    let attempts = 0;
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
    const input = {
      title: "Original",
      bodyMd: "Original Markdown\r\n$Z=0$ 🧭",
      kind: "NOTE" as const,
      day: null,
    };
    try {
      const original = await runtime.saveNote(null, 0, input);
      const concurrent = async () => {
        if (mode === "SAME_NOTE")
          await other.saveNote(original.id, original.version, {
            ...input,
            title: "Concurrent writer",
          });
        else
          await other.service.create(other.context, {
            title: "Unrelated",
            type: "PROJECT",
          });
        if (mode === "CONTINUOUS") interfere = concurrent;
      };
      interfere = concurrent;
      const update = runtime.saveNote(original.id, original.version, {
        ...input,
        bodyMd: input.bodyMd + "\n![original](/api/library/asset?id=original)",
      });
      if (mode === "UNRELATED")
        await expect(update).resolves.toMatchObject({ version: 2 });
      else
        await expect(update).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      const row = await first.metadata.get(
        identity.workspaceId,
        "notes",
        original.id,
      );
      expect(row?.version).toBe(mode === "CONTINUOUS" ? 1 : 2);
      expect(await other.readDocumentBody(original)).toMatchObject({
        title: mode === "SAME_NOTE" ? "Concurrent writer" : "Original",
        bodyMd:
          mode === "UNRELATED"
            ? input.bodyMd + "\n![original](/api/library/asset?id=original)"
            : input.bodyMd,
      });
      expect(attempts).toBe(mode === "CONTINUOUS" ? 3 : 1);
      const outbox = await first.outbox.list(identity.workspaceId);
      expect(
        outbox.filter((entry) => entry.entityType === "notes"),
      ).toHaveLength(mode === "CONTINUOUS" ? 1 : 2);
    } finally {
      first.close();
      second.close();
    }
  },
);
