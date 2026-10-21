import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["UNRELATED", "SAME_LINK", "CONTINUOUS"])(
  "unlink staging retains original CAS under %s contention",
  async (mode) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open("unlink-contention", factory);
    const second = await IndexedDbLocalStore.open("unlink-contention", factory);
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
    };
    const blobs = { get: async () => null, put: async () => {} };
    const wiki = { extract: () => [], resolve: () => [] };
    const clock = { now: () => "2026-10-20T00:00:00Z" };
    const ids = { next: () => crypto.randomUUID() };
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
      const project = await runtime.service.create(runtime.context, {
        title: "Project",
        type: "PROJECT",
      });
      const note = await runtime.saveNote(null, 0, {
        title: "Reference",
        bodyMd: "Exact Markdown\n",
        kind: "NOTE",
        day: null,
      });
      const from = { kind: "WORK" as const, id: project.id };
      const to = { kind: "NOTE" as const, id: note.id };
      const original = await runtime.link(from, to, "REFERENCES");
      const concurrent = async () => {
        if (mode === "SAME_LINK")
          await other.unlink(original.id, original.version);
        else await other.service.create(other.context, { title: "Unrelated" });
        if (mode === "CONTINUOUS") interfere = concurrent;
      };
      interfere = concurrent;
      const result = runtime.unlink(original.id, original.version);
      if (mode === "UNRELATED")
        await expect(result).resolves.toMatchObject({
          id: original.id,
          version: 2,
          deletedAt: clock.now(),
        });
      else
        await expect(result).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      const links = await first.metadata.list(identity.workspaceId, "links");
      expect(links).toHaveLength(1);
      expect(links[0]?.version).toBe(mode === "CONTINUOUS" ? 1 : 2);
      expect(links[0]?.value).toMatchObject({
        from,
        to,
        relation: "REFERENCES",
        deletedAt: mode === "CONTINUOUS" ? null : clock.now(),
      });
      expect(attempts).toBe(mode === "CONTINUOUS" ? 3 : 1);
      expect(await first.outbox.list(identity.workspaceId)).toHaveLength(
        mode === "CONTINUOUS" ? 6 : mode === "SAME_LINK" ? 4 : 5,
      );
      expect(
        await runtime.readDocumentBody({
          ...note,
          deletedAt: null,
        }),
      ).toMatchObject({ bodyMd: "Exact Markdown\n" });
    } finally {
      first.close();
      second.close();
    }
  },
);
