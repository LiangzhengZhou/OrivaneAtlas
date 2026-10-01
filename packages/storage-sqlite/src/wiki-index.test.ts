import { randomUUID } from "node:crypto";
import { LibraryService } from "@arclattice/application";
import { expect, it } from "vitest";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("persists outgoing links, unresolved references and replacements with revisions", async () => {
  const db = await harness.create();
  await db.request(context, null, async (_uow, _notes, _connected, store) => {
    const service = new LibraryService(
      store,
      { require: async () => {} },
      { now: () => "2026-10-01T00:00:00.000Z" },
      { next: randomUUID },
    );
    const space = await service.save(context, null, 0, {
      kind: "SPACE",
      spaceId: null,
      title: "Wiki",
      bodyMd: "",
    });
    const target = await service.save(context, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Architecture",
      bodyMd: "# Storage",
    });
    const source = await service.save(context, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Home",
      bodyMd: "[[Architecture#Storage|Design]] [[Future Architecture]]",
    });
    expect(await store.wikiLinks!()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDocumentId: source.id,
          targetDocumentId: target.id,
          alias: "Design",
          heading: "Storage",
        }),
        expect.objectContaining({
          targetDocumentId: null,
          targetText: "Future Architecture",
        }),
      ]),
    );
    await service.save(context, target.id, target.version, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Renamed",
      bodyMd: "# Storage",
    });
    const resaved = await service.save(context, source.id, source.version, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Home",
      bodyMd:
        "[[Architecture#Storage|Design]] [[Future Architecture]]\nUpdated",
    });
    expect(
      (await store.wikiLinks!()).find(
        (link) => link.targetText === "Architecture",
      )?.targetDocumentId,
    ).toBe(target.id);
    const future = await service.save(context, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Future   Architecture",
      bodyMd: "",
    });
    expect(
      (await store.wikiLinks!()).find(
        (link) => link.targetText === "Future Architecture",
      )?.targetDocumentId,
    ).toBe(future.id);
    await service.save(context, source.id, resaved.version, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Home",
      bodyMd: "No links",
    });
    expect(await store.wikiLinks!()).toEqual([]);
    expect(await store.revisions(source.id)).toHaveLength(3);
  });
});
