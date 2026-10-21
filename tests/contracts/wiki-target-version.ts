import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  LibraryService,
  type LibraryStore,
} from "../../packages/application/src/library";

export async function wikiTargetVersionScenario(
  run: <T>(operation: (store: LibraryStore) => Promise<T>) => Promise<T>,
  row: () => Promise<{
    version: number;
    target: string | null;
    updated: string;
  }>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  let tick = 0;
  const service = (store: LibraryStore) =>
    new LibraryService(
      store,
      { require: async () => {} },
      {
        now: () => new Date(Date.UTC(2026, 9, 16, 0, 0, ++tick)).toISOString(),
      },
      { next: randomUUID },
    );
  const space = await run((store) =>
    service(store).save(actor, null, 0, {
      kind: "SPACE",
      spaceId: null,
      title: "Wiki",
      bodyMd: "",
    }),
  );
  await run((store) =>
    service(store).save(actor, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Source",
      bodyMd: "[[Future]]",
    }),
  );
  let previous = await row();
  expect(previous.target).toBeNull();
  await expect(
    run(async (store) => {
      await service(store).save(actor, null, 0, {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Future",
        bodyMd: "Aborted",
      });
      throw new Error("ROLLBACK_WIKI_TARGET");
    }),
  ).rejects.toThrow("ROLLBACK_WIKI_TARGET");
  expect(await row()).toEqual(previous);
  const target = await run((store) =>
    service(store).save(actor, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Future",
      bodyMd: "Original",
    }),
  );
  const changed = async (id: string | null) => {
    const current = await row();
    expect(current).toMatchObject({
      target: id,
      version: previous.version + 1,
    });
    expect(current.updated).not.toBe(previous.updated);
    previous = current;
  };
  await changed(target.id);
  const deleted = await run((store) =>
    service(store).setDeleted(actor, target.id, target.version, true),
  );
  await changed(null);
  const restored = await run((store) =>
    service(store).setDeleted(actor, target.id, deleted.version, false),
  );
  await changed(target.id);
  const revised = await run((store) =>
    service(store).save(actor, target.id, restored.version, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Future",
      bodyMd: "Revised",
    }),
  );
  expect(await row()).toEqual(previous);
  const deletedAgain = await run((store) =>
    service(store).setDeleted(actor, target.id, revised.version, true),
  );
  await changed(null);
  await run((store) =>
    service(store).purge(actor, target.id, deletedAgain.version),
  );
  expect(await row()).toEqual(previous);
  const replacement = await run((store) =>
    service(store).save(actor, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Future",
      bodyMd: "Replacement",
    }),
  );
  await changed(replacement.id);
}
