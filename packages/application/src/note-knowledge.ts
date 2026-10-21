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

  private async space(context: ActorContext, id: string) {
    const space = this.library.listMetadata
      ? (await this.library.listMetadata()).find((entry) => entry.id === id)
      : await this.library.get(id);
    if (
      !space ||
      space.workspaceId !== context.workspaceId ||
      space.deletedAt ||
      space.kind !== "SPACE"
    )
      throw new DomainError("NOT_FOUND");
    return space;
  }

  async linkNoteToSpace(
    context: ActorContext,
    noteId: string,
    version: number,
    spaceId: string,
    stableLinkId?: string,
  ) {
    context = Object.freeze({ ...context });
    if (stableLinkId !== undefined)
      await this.authorization.require(context, "graph:write");
    await this.source(context, noteId, version);
    const space = await this.space(context, spaceId);
    if (
      space.workspaceId !== context.workspaceId ||
      space.deletedAt ||
      space.kind !== "SPACE"
    )
      throw new DomainError("NOT_FOUND");
    const service = new ConnectedService(
      this.connected,
      this.authorization,
      this.clock,
      this.ids,
    );
    const from = { kind: "NOTE" as const, id: noteId },
      to = { kind: "SPACE" as const, id: spaceId };
    return stableLinkId === undefined
      ? service.link(context, from, to, "REFERENCES")
      : service.linkWithStableId(context, stableLinkId, from, to, "REFERENCES");
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
    stable?: { documentId: string; linkId: string },
  ) {
    context = Object.freeze({ ...context });
    input = structuredClone(input);
    stable = stable === undefined ? undefined : structuredClone(stable);
    if (stable) {
      await this.authorization.require(context, "work:create");
      await this.authorization.require(context, "graph:write");
      if (input.archiveSourceNote)
        await this.authorization.require(context, "work:delete");
    }
    const note = await this.source(context, noteId, version);
    if (typeof input.archiveSourceNote !== "boolean")
      throw new DomainError("VALIDATION_ERROR");
    const space = await this.space(context, input.spaceId);
    if (
      space.workspaceId !== context.workspaceId ||
      space.deletedAt ||
      space.kind !== "SPACE"
    )
      throw new DomainError("NOT_FOUND");
    const service = new LibraryService(
      this.library,
      this.authorization,
      this.clock,
      this.ids,
      note.provenance,
      note.aiPolicy,
    );
    const documentInput = {
      kind: "DOCUMENT" as const,
      spaceId: space.id,
      title: note.title,
      bodyMd: note.bodyMd,
      parentDocumentId: input.parentDocumentId ?? null,
      ...(note.aiPolicy ? { aiPolicy: note.aiPolicy } : {}),
    };
    const document = stable
      ? await service.createWithStableId(
          context,
          stable.documentId,
          documentInput,
        )
      : await service.save(context, null, 0, documentInput);
    const connections = new ConnectedService(
      this.connected,
      this.authorization,
      this.clock,
      this.ids,
    );
    const from = { kind: "NOTE" as const, id: noteId },
      to = { kind: "DOCUMENT" as const, id: document.id };
    if (stable)
      await connections.linkWithStableId(
        context,
        stable.linkId,
        from,
        to,
        "REFERENCES",
      );
    else await connections.link(context, from, to, "REFERENCES");
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
