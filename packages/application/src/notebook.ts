import {
  type ActorContext,
  DomainError,
  requireTitle,
} from "@arclattice/domain";
import type { AuthorizationService, Clock, IdGenerator } from "./index";

export interface Note {
  id: string;
  workspaceId: string;
  title: string;
  bodyMd: string;
  kind: "NOTE" | "JOURNAL";
  day: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  deletedAt: string | null;
  classification: "PRIVATE";
  boundary: "REMOTE";
  aiAccess: "DENY";
  provenance: "HUMAN" | "EXTERNAL_AI";
}
export interface NoteInput {
  title: string;
  bodyMd: string;
  kind: "NOTE" | "JOURNAL";
  day: string | null;
}
export interface NotebookStore {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note>;
  save(note: Note, expectedVersion: number): Promise<void>;
  revisions(id: string): Promise<Note[]>;
}
export class NotebookService {
  constructor(
    private readonly store: NotebookStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly source: Note["provenance"] = "HUMAN",
  ) {}
  async list(context: ActorContext) {
    await this.authorization.require(context, "work:read");
    return this.store.list();
  }
  async revisions(context: ActorContext, id: string) {
    await this.authorization.require(context, "work:read");
    if ((await this.store.get(id)).workspaceId !== context.workspaceId)
      throw new DomainError("NOT_FOUND");
    return this.store.revisions(id);
  }
  async save(
    context: ActorContext,
    id: string | null,
    version: number,
    input: NoteInput,
  ) {
    await this.authorization.require(
      context,
      id ? "work:update" : "work:create",
    );
    const old = id ? await this.store.get(id) : null;
    if (old && (old.workspaceId !== context.workspaceId || old.deletedAt))
      throw new DomainError("NOT_FOUND");
    if (old && (old.kind !== input.kind || old.day !== input.day))
      throw new DomainError("VALIDATION_ERROR");
    if (
      typeof input.bodyMd !== "string" ||
      input.bodyMd.length > 200_000 ||
      !["NOTE", "JOURNAL"].includes(input.kind)
    )
      throw new DomainError("VALIDATION_ERROR");
    if (
      input.kind === "JOURNAL" &&
      (!input.day ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
        Number.isNaN(Date.parse(input.day)) ||
        new Date(input.day).toISOString().slice(0, 10) !== input.day)
    )
      throw new DomainError("VALIDATION_ERROR");
    if (input.kind === "NOTE" && input.day !== null)
      throw new DomainError("VALIDATION_ERROR");
    const now = this.clock.now();
    const note: Note = {
      id: old?.id ?? this.ids.next(),
      workspaceId: context.workspaceId,
      title: requireTitle(input.title),
      bodyMd: input.bodyMd,
      kind: input.kind,
      day: input.day,
      version: (old?.version ?? 0) + 1,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      createdBy: old?.createdBy ?? context.principalId,
      updatedBy: context.principalId,
      deletedAt: null,
      classification: "PRIVATE",
      boundary: "REMOTE",
      aiAccess: "DENY",
      provenance: this.source,
    };
    await this.store.save(note, version);
    return note;
  }
  async setDeleted(
    context: ActorContext,
    id: string,
    version: number,
    deleted: boolean,
  ) {
    await this.authorization.require(
      context,
      deleted ? "work:delete" : "work:update",
    );
    const old = await this.store.get(id);
    if (old.workspaceId !== context.workspaceId)
      throw new DomainError("NOT_FOUND");
    const note = {
      ...old,
      version: old.version + 1,
      updatedBy: context.principalId,
      updatedAt: this.clock.now(),
      deletedAt: deleted ? this.clock.now() : null,
    };
    await this.store.save(note, version);
    return note;
  }
}
