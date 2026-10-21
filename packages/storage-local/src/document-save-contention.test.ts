import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["UNRELATED", "SAME_DOCUMENT", "CONTINUOUS"])(
  "document save retains exact entity CAS under %s contention",
  async (mode) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open(
      "document-save-contention",
      factory,
    );
    const second = await IndexedDbLocalStore.open(
      "document-save-contention",
      factory,
    );
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const clock = { now: () => "2026-10-16T00:00:00.000Z" };
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
      const space = await runtime.saveLibrary(null, 0, {
        kind: "SPACE",
        spaceId: null,
        title: "Space",
        bodyMd: "",
      });
      const input = {
        kind: "DOCUMENT" as const,
        spaceId: space.id,
        title: "",
        bodyMd: "Original",
      };
      const original = await runtime.saveLibrary(null, 0, input);
      const concurrent = async () => {
        if (mode === "SAME_DOCUMENT")
          await other.saveLibrary(original.id, original.version, {
            ...input,
            bodyMd: "Other writer",
          });
        else
          await other.service.create(other.context, {
            title: "Unrelated",
            type: "TASK",
          });
        if (mode === "CONTINUOUS") interfere = concurrent;
      };
      interfere = concurrent;
      const saving = runtime.saveLibrary(original.id, original.version, {
        ...input,
        bodyMd: "My exact draft\n",
      });
      if (mode === "UNRELATED")
        await expect(saving).resolves.toMatchObject({
          id: original.id,
          version: 2,
          title: "",
          bodyMd: "My exact draft\n",
        });
      else
        await expect(saving).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      const row = await first.metadata.get(
        identity.workspaceId,
        "library",
        original.id,
      );
      expect(row?.version).toBe(mode === "CONTINUOUS" ? 1 : 2);
      expect(await runtime.readDocumentBody(original)).toMatchObject({
        bodyMd:
          mode === "UNRELATED"
            ? "My exact draft\n"
            : mode === "SAME_DOCUMENT"
              ? "Other writer"
              : "Original",
      });
      expect(attempts).toBe(mode === "CONTINUOUS" ? 3 : 1);
      expect(await first.outbox.list(identity.workspaceId)).toHaveLength(
        mode === "CONTINUOUS" ? 5 : mode === "SAME_DOCUMENT" ? 3 : 4,
      );
    } finally {
      first.close();
      second.close();
    }
  },
);
