import { randomUUID } from "node:crypto";
import { LibraryService } from "@arclattice/application";
import { expect, it } from "vitest";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("persists aliases and parents across transactions, re-resolves rename/delete/restore and rejects cycles", async () => {
  const db = await harness.create();
  const create = await db.request(
    context,
    null,
    async (_uow, _notes, _connected, store) => {
      const service = new LibraryService(
        store,
        { require: async () => {} },
        { now: () => new Date().toISOString() },
        { next: randomUUID },
      );
      const space = await service.save(context, null, 0, {
        kind: "SPACE",
        spaceId: null,
        title: "Wiki",
        bodyMd: "",
      });
      const parent = await service.save(context, null, 0, {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Architecture",
        bodyMd: "",
        aliases: [" Design "],
      });
      const child = await service.save(context, null, 0, {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Storage",
        bodyMd: "[[Design]]",
        parentDocumentId: parent.id,
      });
      await expect(
        service.save(context, parent.id, parent.version, {
          ...parent,
          parentDocumentId: child.id,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(
        service.setDeleted(context, parent.id, parent.version, true),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      return { space, parent, child };
    },
  );
  await db.request(context, null, async (_uow, _notes, _connected, store) => {
    const service = new LibraryService(
      store,
      { require: async () => {} },
      { now: () => new Date().toISOString() },
      { next: randomUUID },
    );
    expect((await store.get(create.child.id)).parentDocumentId).toBe(
      create.parent.id,
    );
    expect((await store.wikiLinks!())[0]?.targetDocumentId).toBe(
      create.parent.id,
    );
    const renamed = await service.save(
      context,
      create.parent.id,
      create.parent.version,
      { ...create.parent, title: "Backend" },
    );
    expect(renamed.aliases).toEqual(["Design", "Architecture"]);
    const source = await service.save(context, null, 0, {
      kind: "DOCUMENT",
      spaceId: create.space.id,
      title: "Home",
      bodyMd: "[[Architecture]]",
    });
    expect(
      (await store.wikiLinks!()).find(
        (link) => link.sourceDocumentId === source.id,
      )?.targetDocumentId,
    ).toBe(renamed.id);
    await service.save(context, create.child.id, create.child.version, {
      ...create.child,
      parentDocumentId: null,
    });
    const deleted = await service.setDeleted(
      context,
      renamed.id,
      renamed.version,
      true,
    );
    expect(
      (await store.wikiLinks!()).every(
        (link) => link.targetDocumentId === null,
      ),
    ).toBe(true);
    await service.setDeleted(context, renamed.id, deleted.version, false);
    expect(
      (await store.wikiLinks!()).every(
        (link) => link.targetDocumentId === renamed.id,
      ),
    ).toBe(true);
    await expect(
      service.save(context, null, 0, {
        kind: "DOCUMENT",
        spaceId: create.space.id,
        title: "Collision",
        bodyMd: "",
        aliases: ["design"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  await db.request(
    { ...context, workspaceId: "workspace-b" },
    null,
    async (_uow, _notes, _connected, store) => {
      expect(await store.list()).toEqual([]);
      await expect(store.get(create.parent.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    },
  );
});
