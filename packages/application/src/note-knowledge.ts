import { type ActorContext, DomainError } from "@arclattice/domain";
import { ConnectedService, type ConnectedStore } from "./connected";
import type { AuthorizationService, Clock, IdGenerator } from "./index";
import { LibraryService, type LibraryStore } from "./library";
import { NotebookService, type NotebookStore } from "./notebook";

/** Execute under one caller-owned UnitOfWork covering all three stores. */
export class NoteKnowledgeService {
  constructor(
    private readonly notes: NotebookStore,
    private readonly library: LibraryStore,
    private readonly connected: ConnectedStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  private async source(context: ActorContext, noteId: string, version: number) {
    await this.authorization.require(context, "work:read");
    const note = await this.notes.get(noteId);
    if (note.workspaceId !== context.workspaceId || note.deletedAt)
      throw new DomainError("NOT_FOUND");
    if (!Number.isSafeInteger(version) || note.version !== version)
      throw new DomainError("VERSION_CONFLICT");
    return note;
  }

  async linkNoteToSpace(
    context: ActorContext,
    noteId: string,
    version: number,
    spaceId: string,
  ) {
    await this.source(context, noteId, version);
    const space = await this.library.get(spaceId);
    if (
      space.workspaceId !== context.workspaceId ||
      space.deletedAt ||
      space.kind !== "SPACE"
    )
      throw new DomainError("NOT_FOUND");
    return new ConnectedService(
      this.connected,
      this.authorization,
      this.clock,
      this.ids,
    ).link(
      context,
      { kind: "NOTE", id: noteId },
      { kind: "SPACE", id: spaceId },
      "REFERENCES",
    );
  }

  async promoteNoteToDocument(
    context: ActorContext,
    noteId: string,
    version: number,
    input: {
      spaceId: string;
      parentDocumentId?: string | null;
      archiveSourceNote: boolean;
    },
  ) {
    const note = await this.source(context, noteId, version);
    if (typeof input.archiveSourceNote !== "boolean")
      throw new DomainError("VALIDATION_ERROR");
    const space = await this.library.get(input.spaceId);
    if (
      space.workspaceId !== context.workspaceId ||
      space.deletedAt ||
      space.kind !== "SPACE"
    )
      throw new DomainError("NOT_FOUND");
    const document = await new LibraryService(
      this.library,
      this.authorization,
      this.clock,
      this.ids,
      note.provenance,
      note.aiPolicy,
    ).save(context, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: note.title,
      bodyMd: note.bodyMd,
      parentDocumentId: input.parentDocumentId ?? null,
      ...(note.aiPolicy ? { aiPolicy: note.aiPolicy } : {}),
    });
    await new ConnectedService(
      this.connected,
      this.authorization,
      this.clock,
      this.ids,
    ).link(
      context,
      { kind: "NOTE", id: noteId },
      { kind: "DOCUMENT", id: document.id },
      "REFERENCES",
    );
    if (input.archiveSourceNote)
      await new NotebookService(
        this.notes,
        this.authorization,
        this.clock,
        this.ids,
      ).setDeleted(context, noteId, version, true);
    return document;
  }
}
