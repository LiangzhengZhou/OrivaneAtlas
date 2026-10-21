import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["UNRELATED", "TARGET_DELETED", "DUPLICATE", "CONTINUOUS"])(
  "link staging retains endpoint and duplicate guards under %s contention",
  async (mode) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open("link-contention", factory);
    const second = await IndexedDbLocalStore.open("link-contention", factory);
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
      const concurrent = async () => {
        if (mode === "TARGET_DELETED")
          await other.deleteNote(note.id, note.version, true);
        else if (mode === "DUPLICATE") await other.link(from, to, "REFERENCES");
        else await other.service.create(other.context, { title: "Unrelated" });
        if (mode === "CONTINUOUS") interfere = concurrent;
      };
      interfere = concurrent;
      const result = runtime.link(from, to, "REFERENCES");
      if (mode === "UNRELATED")
        await expect(result).resolves.toMatchObject({ from, to, version: 1 });
      else
        await expect(result).rejects.toMatchObject({
          code:
            mode === "TARGET_DELETED"
              ? "NOT_FOUND"
              : mode === "DUPLICATE"
                ? "DUPLICATE_EDGE"
                : "VERSION_CONFLICT",
        });
      const links = await first.metadata.list(identity.workspaceId, "links");
      expect(links).toHaveLength(
        ["UNRELATED", "DUPLICATE"].includes(mode) ? 1 : 0,
      );
      expect(attempts).toBe(mode === "CONTINUOUS" ? 3 : 1);
      const pending = await first.outbox.list(identity.workspaceId);
      expect(pending).toHaveLength(
        mode === "CONTINUOUS"
          ? 5
          : mode === "TARGET_DELETED" || mode === "DUPLICATE"
            ? 3
            : 4,
      );
      expect(
        await runtime.readDocumentBody({
          ...note,
          deletedAt: mode === "TARGET_DELETED" ? clock.now() : null,
        }),
      ).toMatchObject({ bodyMd: "Exact Markdown\n" });
    } finally {
      first.close();
      second.close();
    }
  },
);
