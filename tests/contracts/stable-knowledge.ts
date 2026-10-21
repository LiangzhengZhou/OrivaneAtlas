import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  type LibraryEntry,
  LibraryService,
  type LibraryStore,
  type Note,
  NotebookService,
  type NotebookStore,
} from "../../packages/application/src/index";
import { KnowledgeReplayEffects } from "../../packages/application/src/knowledge-replay-effects";

/** Real adapter scenario; stable primary IDs do not bypass Markdown/revision/hierarchy policy. */
export async function stableKnowledgeScenario(
  notes: NotebookStore,
  library: LibraryStore,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const auth = { require: async () => {} },
    clock = { now: () => "2026-10-13T00:00:00Z" },
    ids = { next: randomUUID };
  const notebook = new NotebookService(notes, auth, clock, ids);
  const knowledge = new LibraryService(library, auth, clock, ids);
  const noteId = randomUUID(),
    spaceId = randomUUID(),
    documentId = randomUUID();
  const bodyMd = "第一行\n第二行\n[[target]]\n";
  const note = await notebook.createWithStableId(actor, noteId, {
    kind: "NOTE",
    day: null,
    title: "Stable note",
    bodyMd,
  });
  const accepted = new KnowledgeReplayEffects(actor.workspaceId, [
    {
      collection: "notes",
      id: noteId,
      op: "UPSERT",
      baseVersion: note.version,
    },
  ]);
  const guardedNote = await accepted.run(notes, library, async (guarded) =>
    new NotebookService(guarded, auth, clock, ids).save(
      actor,
      noteId,
      note.version,
      {
        kind: "NOTE",
        day: null,
        title: note.title,
        bodyMd,
      },
    ),
  );
  expect(accepted.acceptedEffects).toEqual([
    expect.objectContaining({
      id: noteId,
      version: 2,
      value: expect.objectContaining({ bodyMd }),
    }),
  ]);
  const detached = accepted.acceptedEffects;
  const first = detached[0];
  if (!first) throw new Error("MISSING_CANONICAL_KNOWLEDGE");
  first.value.bodyMd = "Caller mutation";
  expect(accepted.acceptedEffects[0]?.value.bodyMd).toBe(bodyMd);
  const stale = new KnowledgeReplayEffects(actor.workspaceId, [
    {
      collection: "notes",
      id: noteId,
      op: "UPSERT",
      baseVersion: 1,
    },
  ]);
  await expect(
    stale.run(notes, library, async (guarded) =>
      new NotebookService(guarded, auth, clock, ids).save(actor, noteId, 1, {
        kind: "NOTE",
        day: null,
        title: "Must not overwrite",
        bodyMd: "Lost",
      }),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(stale.acceptedEffects).toEqual([]);
  expect(await notes.get(noteId)).toEqual(guardedNote);
  expect(note).toMatchObject({
    id: noteId,
    workspaceId: actor.workspaceId,
    version: 1,
    createdBy: actor.principalId,
    bodyMd,
  });
  await expect(
    notebook.createWithStableId(actor, noteId, {
      kind: "NOTE",
      day: null,
      title: "Overwrite",
      bodyMd: "Changed",
    }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect((await notes.get(noteId)).bodyMd).toBe(bodyMd);
  const space = await knowledge.createWithStableId(actor, spaceId, {
    kind: "SPACE",
    spaceId: null,
    title: "Stable space",
    bodyMd: "Description",
  });
  expect(space.id).toBe(spaceId);
  const document = await knowledge.createWithStableId(actor, documentId, {
    kind: "DOCUMENT",
    spaceId,
    title: "Stable document",
    bodyMd,
  });
  expect(document).toMatchObject({
    id: documentId,
    spaceId,
    workspaceId: actor.workspaceId,
    version: 1,
    createdBy: actor.principalId,
    bodyMd,
  });
  await expect(
    knowledge.createWithStableId(actor, documentId, {
      kind: "DOCUMENT",
      spaceId,
      title: "Overwrite",
      bodyMd: "Changed",
    }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect((await library.get(documentId)).bodyMd).toBe(bodyMd);
  const updated = await knowledge.save(actor, documentId, 1, {
    kind: "DOCUMENT",
    spaceId,
    title: "Stable document",
    bodyMd: bodyMd + "第三行\n",
  });
  expect(updated.version).toBe(2);
  const recoveredNote = {
    kind: "NOTE" as const,
    day: null,
    title: "Recovered note",
    bodyMd: "Device note\noriginal bytes",
  };
  const recoveredDocument = {
    kind: "DOCUMENT" as const,
    spaceId,
    title: "Recovered document",
    bodyMd: "Device document\n[[target]]",
  };
  for (const collection of ["notes", "library"] as const) {
    const id = collection === "notes" ? noteId : documentId;
    const service = collection === "notes" ? notebook : knowledge;
    await expect(
      collection === "notes"
        ? notebook.restoreAndSave(actor, id, 2, recoveredNote)
        : knowledge.restoreAndSave(actor, id, 2, recoveredDocument),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const deleted = await service.setDeleted(actor, id, 2, true);
    const recovery = new KnowledgeReplayEffects(actor.workspaceId, [
      { collection, id, op: "UPSERT", baseVersion: deleted.version },
      { collection, id, op: "UPSERT", baseVersion: deleted.version + 1 },
    ]);
    const restored = await recovery.run<Note | LibraryEntry>(
      notes,
      library,
      (n, l) =>
        collection === "notes"
          ? new NotebookService(n, auth, clock, ids).restoreAndSave(
              actor,
              id,
              deleted.version,
              recoveredNote,
            )
          : new LibraryService(l, auth, clock, ids).restoreAndSave(
              actor,
              id,
              deleted.version,
              recoveredDocument,
            ),
    );
    expect(restored).toMatchObject({
      id,
      version: 5,
      deletedAt: null,
      bodyMd:
        collection === "notes"
          ? recoveredNote.bodyMd
          : recoveredDocument.bodyMd,
    });
    expect(recovery.acceptedEffects).toEqual([
      expect.objectContaining({ collection, id, version: 5, value: restored }),
    ]);
  }
  expect(
    (await library.revisions(documentId)).some(
      (revision) => revision.bodyMd === bodyMd,
    ),
  ).toBe(true);
  const target = await knowledge.save(actor, null, 0, {
    kind: "SPACE",
    spaceId: null,
    title: "Move target",
    bodyMd: "",
  });
  const beforeMove = await knowledge.read(actor, documentId);
  const moved = await knowledge.moveDocument(
    actor,
    documentId,
    beforeMove.version,
    target.id,
  );
  expect(moved).toEqual({
    ...beforeMove,
    spaceId: target.id,
    parentDocumentId: null,
    version: beforeMove.version + 1,
    updatedAt: clock.now(),
    updatedBy: actor.principalId,
  });
  await expect(
    knowledge.moveDocument(actor, documentId, beforeMove.version, spaceId),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    notebook.createWithStableId(actor, "not-a-uuid", {
      kind: "NOTE",
      day: null,
      title: "Invalid",
      bodyMd,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
}
