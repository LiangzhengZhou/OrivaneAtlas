import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  type ConnectedStore,
  LibraryService,
  type LibraryStore,
  NotebookService,
  type NotebookStore,
  NoteKnowledgeReplayEffects,
  NoteKnowledgeService,
} from "../../packages/application/src/index";

export async function noteKnowledgeReplayScenario(
  run: <T>(
    operation: (
      notes: NotebookStore,
      library: LibraryStore,
      connected: ConnectedStore,
    ) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = { require: async () => {} },
    clock = { now: () => "2026-10-14T00:00:00Z" },
    ids = { next: randomUUID };
  const { note, space } = await run(async (notes, library) => ({
    note: await new NotebookService(notes, auth, clock, ids).save(
      actor,
      null,
      0,
      {
        kind: "NOTE",
        day: null,
        title: "Original capture",
        bodyMd: "第一行\n第二行\n[[Wiki]]",
        aiPolicy: {
          classification: "PRIVATE",
          processingBoundary: "TRUSTED_CLOUD",
          aiAccess: "ASK",
        },
      },
    ),
    space: await new LibraryService(library, auth, clock, ids).save(
      actor,
      null,
      0,
      {
        kind: "SPACE",
        spaceId: null,
        title: "Knowledge",
        bodyMd: "",
      },
    ),
  }));
  const documentId = randomUUID(),
    linkId = randomUUID();
  const effects = [
    {
      collection: "library" as const,
      id: documentId,
      op: "UPSERT" as const,
      baseVersion: 0,
    },
    {
      collection: "links" as const,
      id: linkId,
      op: "UPSERT" as const,
      baseVersion: 0,
    },
    {
      collection: "notes" as const,
      id: note.id,
      op: "UPSERT" as const,
      baseVersion: 1,
    },
  ];
  const promote = (n: NotebookStore, l: LibraryStore, c: ConnectedStore) =>
    new NoteKnowledgeService(n, l, c, auth, clock, ids).promoteNoteToDocument(
      actor,
      note.id,
      1,
      { spaceId: space.id, archiveSourceNote: true },
      { documentId, linkId },
    );
  await expect(
    run((n, l, c) =>
      new NoteKnowledgeReplayEffects(
        actor.workspaceId,
        actor.principalId,
        effects.filter((e) => e.collection !== "notes"),
      ).run(n, l, c, promote),
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  await run(async (n, l, c) => {
    expect(await n.get(note.id)).toEqual(note);
    await expect(l.get(documentId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await c.links()).toEqual([]);
  });
  await run(async (n, l, c) => {
    const guard = new NoteKnowledgeReplayEffects(
      actor.workspaceId,
      actor.principalId,
      effects,
    );
    const document = await guard.run(n, l, c, promote);
    expect(document).toMatchObject({
      id: documentId,
      version: 1,
      title: note.title,
      bodyMd: note.bodyMd,
      aiPolicy: note.aiPolicy,
      provenance: note.provenance,
    });
    expect(guard.acceptedEffects).toHaveLength(3);
    expect(await n.get(note.id)).toMatchObject({
      version: 2,
      bodyMd: note.bodyMd,
      deletedAt: clock.now(),
    });
    expect((await c.links())[0]).toMatchObject({
      id: linkId,
      version: 1,
      from: { kind: "NOTE", id: note.id },
      to: { kind: "DOCUMENT", id: documentId },
    });
  });
  await expect(run((n, l, c) => promote(n, l, c))).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
}
