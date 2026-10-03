import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  LibraryService,
  type LibraryStore,
  NotebookService,
  type NotebookStore,
  type UnitOfWork,
  WorkService,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";
import { DomainError } from "../../packages/domain/src/index";

export type PurgeRunner = <T>(
  actor: ActorContext,
  operation: (
    uow: UnitOfWork,
    library: LibraryStore,
    notes: NotebookStore,
  ) => Promise<T>,
) => Promise<T>;

export async function permanentPurgeScenario(run: PurgeRunner) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const clock = { now: () => "2026-10-03T00:00:00.000Z" };
  const ids = { next: randomUUID };
  const auth = {
    require: async (context: ActorContext) => {
      if (context.principalId !== "human") throw new DomainError("FORBIDDEN");
    },
  };
  const services = (
    uow: UnitOfWork,
    library: LibraryStore,
    notes: NotebookStore,
  ) => ({
    work: new WorkService(uow, auth, clock, ids),
    library: new LibraryService(library, auth, clock, ids),
    notes: new NotebookService(notes, auth, clock, ids),
  });
  const task = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).work.create(actor, { title: "Purge task" }),
  );
  await expect(
    run(actor, async (uow, library, notes) =>
      services(uow, library, notes).work.purge(actor, task.id, task.version),
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const dependent = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).work.create(actor, {
      title: "Surviving dependent",
    }),
  );
  const edgeRecord = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).work.addEdge(actor, task.id, dependent.id),
  );
  await expect(
    run(actor, async (uow, library, notes) =>
      services(uow, library, notes).work.setDeleted(
        actor,
        task.id,
        task.version,
        true,
      ),
    ),
  ).rejects.toMatchObject({ code: "DEPENDENCY_EXISTS" });
  await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).work.removeEdge(actor, edgeRecord.id),
  );
  const deleted = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).work.setDeleted(
      actor,
      task.id,
      task.version,
      true,
    ),
  );
  await expect(
    run(actor, async (uow, library, notes) =>
      services(uow, library, notes).work.purge(actor, task.id, task.version),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    run({ ...actor, workspaceId: "workspace-b" }, async (uow, library, notes) =>
      services(uow, library, notes).work.purge(
        { ...actor, workspaceId: "workspace-b" },
        task.id,
        deleted.version,
      ),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).work.purge(actor, task.id, deleted.version),
  );
  await expect(
    run(actor, async (uow) =>
      uow.run(actor.workspaceId, (tx) => tx.get(task.id)),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await run(actor, (uow) =>
    uow.run(actor.workspaceId, async (tx) => {
      expect(await tx.edges()).toEqual([]);
      expect((await tx.get(dependent.id)).title).toBe("Surviving dependent");
    }),
  );
  const note = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).notes.save(actor, null, 0, {
      title: "Purge note",
      bodyMd: "Original Markdown",
      kind: "NOTE",
      day: null,
    }),
  );
  await expect(
    run({ ...actor, workspaceId: "workspace-b" }, async (uow, library, notes) =>
      services(uow, library, notes).notes.purge(
        { ...actor, workspaceId: "workspace-b" },
        note.id,
        note.version,
      ),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const removedNote = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).notes.setDeleted(
      actor,
      note.id,
      note.version,
      true,
    ),
  );
  await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).notes.purge(
      actor,
      note.id,
      removedNote.version,
    ),
  );
  await run(actor, async (_uow, _library, notes) => {
    expect(await notes.list()).toEqual([]);
    expect(await notes.revisions(note.id)).toEqual([]);
  });
  const space = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).library.save(actor, null, 0, {
      kind: "SPACE",
      spaceId: null,
      title: "Purge space",
      bodyMd: "",
    }),
  );
  const exclusiveAsset = randomUUID(),
    sharedAsset = randomUUID();
  await run(actor, async (_uow, library) => {
    for (const id of [exclusiveAsset, sharedAsset])
      await library.putAsset({
        id,
        spaceId: space.id,
        name: "image.png",
        mime: "image/png",
        base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvQAAAABJRU5ErkJggg==",
      });
  });
  const otherSpace = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).library.save(actor, null, 0, {
      kind: "SPACE",
      spaceId: null,
      title: "Keep space",
      bodyMd: "",
    }),
  );
  const otherDocument = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).library.save(actor, null, 0, {
      kind: "DOCUMENT",
      spaceId: otherSpace.id,
      title: "Keep document",
      bodyMd: "![shared](/api/library/asset?id=" + sharedAsset + ")",
    }),
  );
  const doc = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).library.save(actor, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Purge document",
      bodyMd:
        "![exclusive](/api/library/asset?id=" +
        exclusiveAsset +
        ") ![shared](/api/library/asset?id=" +
        sharedAsset +
        ")",
      aliases: ["Purge alias"],
    }),
  );
  await expect(
    run({ ...actor, workspaceId: "workspace-b" }, async (uow, library, notes) =>
      services(uow, library, notes).library.purge(
        { ...actor, workspaceId: "workspace-b" },
        doc.id,
        doc.version,
      ),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const removedSpace = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).library.setDeleted(
      actor,
      space.id,
      space.version,
      true,
    ),
  );
  await expect(
    run(actor, async (uow, library, notes) =>
      services(uow, library, notes).library.purge(
        actor,
        space.id,
        removedSpace.version,
      ),
    ),
  ).rejects.toMatchObject({ code: "DEPENDENCY_EXISTS" });
  const removedDoc = await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).library.setDeleted(
      actor,
      doc.id,
      doc.version,
      true,
    ),
  );
  await expect(
    run(actor, async (uow, library, notes) =>
      services(uow, library, notes).library.purge(
        actor,
        space.id,
        removedSpace.version,
      ),
    ),
  ).rejects.toMatchObject({ code: "DEPENDENCY_EXISTS" });
  await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).library.purge(
      actor,
      doc.id,
      removedDoc.version,
    ),
  );
  await run(actor, async (uow, library, notes) =>
    services(uow, library, notes).library.purge(
      actor,
      space.id,
      removedSpace.version,
    ),
  );
  await expect(
    run(actor, async (_uow, library) => library.asset(exclusiveAsset)),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await run(actor, async (_uow, library) => {
    expect((await library.list()).map((entry) => entry.id).sort()).toEqual(
      [otherSpace.id, otherDocument.id].sort(),
    );
    expect(await library.asset(sharedAsset)).toMatchObject({ spaceId: null });
    await expect(library.revisions(doc.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await library.wikiLinks?.()).toEqual([]);
  });
}
