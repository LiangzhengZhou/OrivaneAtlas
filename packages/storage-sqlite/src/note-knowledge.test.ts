import { randomUUID } from "node:crypto";
import {
  LibraryService,
  NotebookService,
  NoteKnowledgeService,
} from "@arclattice/application";
import { expect, it } from "vitest";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
const auth = { require: async () => {} };
const clock = { now: () => "2026-10-02T10:00:00.000Z" };
const ids = { next: randomUUID };
it("promotes atomically, preserves Markdown/policy/provenance and links without duplicating a document", async () => {
  const db = await harness.create();
  const state = await db.request(
    context,
    null,
    async (_uow, notes, connected, library) => {
      const space = await new LibraryService(library, auth, clock, ids).save(
        context,
        null,
        0,
        { kind: "SPACE", spaceId: null, title: "Knowledge", bodyMd: "" },
      );
      const note = await new NotebookService(notes, auth, clock, ids).save(
        context,
        null,
        0,
        {
          kind: "NOTE",
          day: null,
          title: "Capture",
          bodyMd: "# Original\n[[Architecture]]\n- [ ] prose",
          aiPolicy: {
            classification: "PRIVATE",
            processingBoundary: "TRUSTED_CLOUD",
            aiAccess: "ASK",
          },
        },
      );
      const service = new NoteKnowledgeService(
        notes,
        library,
        connected,
        auth,
        clock,
        ids,
      );
      await service.linkNoteToSpace(context, note.id, note.version, space.id);
      expect(
        (await library.list()).filter((entry) => entry.kind === "DOCUMENT"),
      ).toEqual([]);
      const document = await service.promoteNoteToDocument(
        context,
        note.id,
        note.version,
        { spaceId: space.id, archiveSourceNote: true },
      );
      expect(document.bodyMd).toBe(note.bodyMd);
      expect(document.title).toBe(note.title);
      expect(document.aiPolicy).toEqual(note.aiPolicy);
      expect(document.provenance).toBe(note.provenance);
      expect((await notes.get(note.id)).deletedAt).not.toBeNull();
      expect(
        (await connected.links()).some(
          (link) => link.from.id === note.id && link.to.id === document.id,
        ),
      ).toBe(true);
      return { noteId: note.id, documentId: document.id };
    },
  );
  await db.request(
    { ...context, workspaceId: "workspace-b" },
    null,
    async (_uow, notes, _connected, library) => {
      await expect(notes.get(state.noteId)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(library.get(state.documentId)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    },
  );
});

it("rolls back document/revision/wiki/activity writes if source archival is forbidden", async () => {
  const db = await harness.create();
  const state = await db.request(
    context,
    null,
    async (_uow, notes, _connected, library) => {
      const space = await new LibraryService(library, auth, clock, ids).save(
        context,
        null,
        0,
        { kind: "SPACE", spaceId: null, title: "Wiki", bodyMd: "" },
      );
      const note = await new NotebookService(notes, auth, clock, ids).save(
        context,
        null,
        0,
        { kind: "NOTE", day: null, title: "Captured", bodyMd: "unchanged" },
      );
      return { space, note };
    },
  );
  await expect(
    db.request(context, null, (_uow, notes, connected, library) =>
      new NoteKnowledgeService(
        notes,
        library,
        connected,
        {
          require: async (_actor, permission) => {
            if (permission === "work:delete") throw new Error("FORBIDDEN");
          },
        },
        clock,
        ids,
      ).promoteNoteToDocument(context, state.note.id, state.note.version, {
        spaceId: state.space.id,
        archiveSourceNote: true,
      }),
    ),
  ).rejects.toThrow("FORBIDDEN");
  await db.request(context, null, async (_uow, notes, connected, library) => {
    expect((await library.list()).map((entry) => entry.id)).toEqual([
      state.space.id,
    ]);
    expect(await connected.links()).toEqual([]);
    expect(await notes.get(state.note.id)).toEqual(state.note);
  });
});
