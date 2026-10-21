import { LocalRuntime } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { LocalWorkspace } from "../../application/src/local-workspace";
import { IndexedDbLocalStore } from "./indexed-db";

it.each([
  { sameEntity: false, action: "RESTORE" },
  { sameEntity: true, action: "RESTORE" },
  { sameEntity: false, action: "UPDATE" },
  { sameEntity: true, action: "UPDATE" },
])(
  "$action preserves entity CAS during contention (same entity: $sameEntity)",
  async ({ sameEntity, action }) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open("restore-contention", factory);
    const second = await IndexedDbLocalStore.open(
      "restore-contention",
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
      put: async () => {
        throw new Error("unexpected blob write");
      },
    };
    const wiki = { extract: () => [], resolve: () => [] };
    const clock = { now: () => "2026-10-16T00:00:00.000Z" };
    const ids = { next: () => crypto.randomUUID() };
    const other = new LocalRuntime(
      new LocalWorkspace(second.metadata, blobs, identity, wiki, clock, ids),
    );
    let interfere = false;
    let interfereWith: { id: string; version: number } | null = null;
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        {
          ...first.metadata,
          commit: async (...args) => {
            if (interfere) {
              interfere = false;
              if (sameEntity && interfereWith) {
                if (action === "UPDATE")
                  await other.service.update(
                    other.context,
                    interfereWith.id,
                    interfereWith.version,
                    { title: "Other writer" },
                  );
                else
                  await other.service.setDeleted(
                    other.context,
                    interfereWith.id,
                    interfereWith.version,
                    false,
                  );
              } else
                await other.service.create(other.context, {
                  title: "Unrelated",
                  type: "TASK",
                });
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
      const deleted =
        action === "UPDATE"
          ? project
          : await runtime.service.setDeleted(
              runtime.context,
              project.id,
              project.version,
              true,
            );
      interfere = true;
      interfereWith = deleted;
      const restore =
        action === "UPDATE"
          ? runtime.service.update(
              runtime.context,
              deleted.id,
              deleted.version,
              { title: "My exact title" },
            )
          : runtime.service.setDeleted(
              runtime.context,
              deleted.id,
              deleted.version,
              false,
            );
      if (sameEntity)
        await expect(restore).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      else
        await expect(restore).resolves.toMatchObject({
          deletedAt: null,
          version: deleted.version + 1,
        });
      const stored = await first.metadata.get(
        identity.workspaceId,
        "items",
        project.id,
      );
      expect(stored?.version).toBe(deleted.version + 1);
      expect(stored?.value).toMatchObject({ deletedAt: null });
      if (action === "UPDATE")
        expect(stored?.value).toMatchObject({
          title: sameEntity ? "Other writer" : "My exact title",
        });
      expect(
        await first.metadata.list(identity.workspaceId, "items"),
      ).toHaveLength(sameEntity ? 1 : 2);
      expect(await first.outbox.list(identity.workspaceId)).toHaveLength(
        (sameEntity ? 3 : 4) - (action === "UPDATE" ? 1 : 0),
      );
    } finally {
      first.close();
      second.close();
    }
  },
);
