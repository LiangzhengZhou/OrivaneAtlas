import {
  type ActorContext,
  DomainError,
  type EntityMemoInput,
  type ReminderInput,
} from "@arclattice/domain";
import type { CategoryService } from "./categories";
import type { EntityRef, KnowledgeLink } from "./connected";
import type { EntityMemoIdentity, EntityMemoTarget } from "./entity-memos";
import { FileProjectLinkError, type FileUploadInput } from "./files";
import type { WorkService } from "./index";
import type { LibraryAsset, LibraryEntry, LibraryInput } from "./library";
import { LocalBodyUnavailableError } from "./local-body-availability";
import { localDto } from "./local-dto";
import { LocalReadSnapshotChangedError } from "./local-mutation-transaction";
import { LocalStorageError } from "./local-persistence";
import type { LocalWorkspace } from "./local-workspace";
import type { ManualOrderService } from "./manual-order";
import type {
  MemoFormalization,
  MemoProposal,
  MemoProposalService,
} from "./memo-proposals";
import {
  type NoteWikiResolver,
  noteWikiReferences,
} from "./note-wiki-references";
import type { Note, NoteInput } from "./notebook";
import type { OrganizeInput } from "./organization";
import type { ProjectService } from "./project-materials";
import type { WorkflowService } from "./workflows";
import type {
  WorkspaceLibraryEntry,
  WorkspaceNote,
} from "./workspace-bootstrap";

export type LocalWorkService = Pick<
  WorkService,
  | "snapshot"
  | "create"
  | "update"
  | "setDeleted"
  | "purge"
  | "addEdge"
  | "removeEdge"
  | "setCalendarSettings"
  | "setNavigationPreference"
  | "moveNavigationPreference"
>;

/** Product-facing local contract. Every call enters the same durable Application boundary. */
export class LocalRuntime {
  backup() {
    return this.workspace.backup();
  }
  readonly service: LocalWorkService;
  readonly context: ActorContext;

  constructor(
    private readonly workspace: LocalWorkspace,
    private readonly memoIdentity?: EntityMemoIdentity,
  ) {
    this.context = workspace.context;
    this.service = {
      snapshot: (actor, includeDeleted) => {
        const context = { ...actor };
        return workspace.run((s) => s.work.snapshot(context, includeDeleted));
      },
      create: (actor, input) => {
        const captured = structuredClone(input);
        const context = { ...actor };
        return this.restartAbortedWorkspaceWrite(() =>
          workspace.run(
            (s) => s.work.create(context, captured),
            (result) => ({
              name: "work.create",
              input: localDto({ id: result.id, input: captured }),
            }),
          ),
        );
      },
      update: (actor, id, version, input) => {
        const captured = structuredClone(input);
        const context = { ...actor };
        return this.restartAbortedWorkspaceWrite(() =>
          workspace.run(
            (s) => s.work.update(context, id, version, captured),
            () => ({
              name: "work.update",
              input: localDto({ id, version, input: captured }),
            }),
          ),
        );
      },
      setDeleted: async (actor, id, version, deleted) => {
        const context = { ...actor };
        // Only restart an aborted staging transaction on workspace-revision
        // contention. The user's entity CAS and authorization remain unchanged.
        for (let attempt = 0; ; attempt++) {
          try {
            return await workspace.run(
              (s) => s.work.setDeleted(context, id, version, deleted),
              () => ({
                name: "work.delete",
                input: localDto({ id, version, deleted }),
              }),
            );
          } catch (error) {
            if (
              attempt >= 2 ||
              !(error instanceof LocalStorageError) ||
              error.code !== "VERSION_CONFLICT" ||
              error.conflict?.collection !== "$local.workspace" ||
              error.conflict.entityId !== "revision"
            )
              throw error;
          }
        }
      },
      purge: (actor, id, version) => {
        const context = { ...actor };
        return workspace.run(
          (s) => s.work.purge(context, id, version),
          () => ({ name: "work.purge", input: localDto({ id, version }) }),
        );
      },
      addEdge: (actor, fromId, toId, type) => {
        const context = { ...actor };
        return workspace.run(
          (s) => s.work.addEdge(context, fromId, toId, type),
          (result) => ({
            name: "edge.create",
            input: localDto({ id: result.id, fromId, toId, type }),
          }),
        );
      },
      removeEdge: (actor, id) => {
        const context = { ...actor };
        return workspace.run(
          (s) => s.work.removeEdge(context, id),
          () => ({ name: "edge.delete", input: localDto({ id }) }),
        );
      },
      setCalendarSettings: (actor, version, timezone) => {
        const context = { ...actor };
        return workspace.run(
          (s) => s.work.setCalendarSettings(context, version, timezone),
          () => ({
            name: "calendar.settings",
            input: localDto({ version, timezone }),
          }),
        );
      },
      setNavigationPreference: (actor, input) => {
        const captured = structuredClone(input);
        const context = { ...actor };
        return workspace.run(
          (s) => s.work.setNavigationPreference(context, captured),
          () => ({ name: "navigation.save", input: localDto(captured) }),
        );
      },
      moveNavigationPreference: (actor, input) => {
        const captured = structuredClone(input);
        const context = { ...actor };
        return workspace.run(
          (s) => s.work.moveNavigationPreference(context, captured),
          () => ({ name: "navigation.move", input: localDto(captured) }),
        );
      },
    };
  }

  getEntityMemo(target: EntityMemoTarget) {
    if (!this.memoIdentity)
      throw new Error("LOCAL_MEMO_IDENTITY_PORT_INCOMPLETE");
    const captured = structuredClone(target);
    return this.workspace.runEntityMemos(this.memoIdentity, (service) =>
      service.get(this.context, captured),
    );
  }

  prepareMemoProposal(
    service: MemoProposalService,
    target: EntityMemoTarget,
    change: MemoFormalization,
  ) {
    if (!this.memoIdentity)
      throw new Error("LOCAL_MEMO_IDENTITY_PORT_INCOMPLETE");
    const captured = structuredClone({ target, change });
    return this.workspace.runEntityMemos(this.memoIdentity, async (memos) => {
      const source = await memos.get(this.context, captured.target);
      if (!source) throw new DomainError("NOT_FOUND");
      return service.propose(this.context, source, captured.change);
    });
  }

  applyMemoProposal(service: MemoProposalService, proposalInput: MemoProposal) {
    if (!this.memoIdentity)
      throw new Error("LOCAL_MEMO_IDENTITY_PORT_INCOMPLETE");
    const proposal = structuredClone(proposalInput);
    return this.workspace.runEntityMemos(
      this.memoIdentity,
      async (memos, services) => {
        const source = await memos.get(this.context, proposal.source);
        if (!source) throw new DomainError("NOT_FOUND");
        const change = await service.review(this.context, proposal, source);
        if (change.kind === "CREATE_TASK") {
          const input = {
            title: change.title,
            descriptionMd: change.bodyMd,
            projectIds: change.projectId ? [change.projectId] : [],
          };
          const item = await services.work.createWithStableId(
            this.context,
            proposal.id,
            input,
          );
          return {
            resultId: item.id,
            command: {
              name: "work.create" as const,
              input: localDto({ id: item.id, input }),
            },
          };
        }
        let id: string | null = null,
          version = 0;
        let input: LibraryInput;
        if (change.kind === "CREATE_DOCUMENT") {
          input = {
            kind: "DOCUMENT",
            spaceId: change.spaceId,
            title: change.title,
            bodyMd: change.bodyMd,
          };
        } else {
          const document = await services.library.read(
            this.context,
            change.documentId,
          );
          if (document.kind !== "DOCUMENT" || document.deletedAt)
            throw new DomainError("NOT_FOUND");
          if (document.version !== change.version)
            throw new DomainError("VERSION_CONFLICT");
          id = document.id;
          version = document.version;
          input = {
            kind: "DOCUMENT",
            spaceId: document.spaceId,
            title: document.title,
            bodyMd:
              document.bodyMd + (document.bodyMd ? "\n\n" : "") + change.bodyMd,
            ...(document.parentDocumentId === undefined
              ? {}
              : { parentDocumentId: document.parentDocumentId }),
            ...(document.aliases === undefined
              ? {}
              : { aliases: document.aliases }),
            ...(document.aiPolicy === undefined
              ? {}
              : { aiPolicy: document.aiPolicy }),
          };
        }
        const document =
          id === null
            ? await services.library.createWithStableId(
                this.context,
                proposal.id,
                input,
              )
            : await services.library.save(this.context, id, version, input);
        return {
          resultId: document.id,
          command: {
            name: "library.save" as const,
            input: localDto({
              id: document.id,
              version,
              create: id === null,
              input,
            }),
          },
        };
      },
      (result) => result.command,
    );
  }

  saveEntityMemo(input: EntityMemoInput, version: number, deleted = false) {
    if (!this.memoIdentity)
      throw new Error("LOCAL_MEMO_IDENTITY_PORT_INCOMPLETE");
    const captured = structuredClone(input);
    return this.workspace.runEntityMemos(
      this.memoIdentity,
      (service) => service.save(this.context, captured, version, deleted),
      (result) => ({
        name: "memo.save",
        input: localDto({
          id: result?.id ?? null,
          version,
          input: captured,
          deleted,
        }),
      }),
    );
  }

  loadWorkspace() {
    return this.readLocalSnapshot(() => this.workspace.snapshot());
  }

  loadWorkspaceWithRevision() {
    return this.readLocalSnapshot(() => this.workspace.snapshotWithRevision());
  }
  workspaceRevision() {
    return this.workspace.revision();
  }

  uploadFile(input: FileUploadInput, bytes: Blob) {
    const captured = structuredClone(input);
    return this.workspace.run(
      (s) => s.files.upload(this.context, captured, bytes),
      (result) => ({
        name: "file.upload",
        input: localDto({
          id: result.id,
          input: captured,
          contentHash: result.contentHash,
          size: result.size,
        }),
      }),
    );
  }
  async uploadProjectFile(
    projectId: string,
    input: FileUploadInput,
    bytes: Blob,
  ) {
    const captured = structuredClone(input);
    await this.readLocalSnapshot(() =>
      this.workspace.run(async (s) => {
        const project = await s.ports.work.get(projectId);
        if (project.type !== "PROJECT" || project.deletedAt)
          throw new DomainError("NOT_FOUND");
      }),
    );
    const file = await this.uploadFile(captured, bytes);
    try {
      await this.link(
        { kind: "WORK", id: projectId },
        { kind: "FILE", id: file.id },
        "REFERENCES",
      );
    } catch (cause) {
      throw new FileProjectLinkError(file, cause);
    }
    return file;
  }
  renameFile(id: string, version: number, name: string) {
    return this.workspace.run(
      (s) => s.files.rename(this.context, id, version, name),
      () => ({ name: "file.rename", input: localDto({ id, version, name }) }),
    );
  }
  async importLegacyProjectFile(id: string, version: number, bytes: Blob) {
    const material = await this.readLocalSnapshot(() =>
      this.workspace.run((s) => s.ports.projects.get(id)),
    );
    if (
      material.kind !== "FILE" ||
      material.deletedAt ||
      material.workspaceId !== this.context.workspaceId
    )
      throw new DomainError("NOT_FOUND");
    const input = {
      name: material.title,
      mime: material.mime ?? "application/octet-stream",
      spaceId: null,
    };
    const file = await this.workspace.run(
      async (s) => {
        const current = await s.ports.projects.get(id);
        if (
          current.version !== version ||
          current.deletedAt ||
          current.kind !== "FILE" ||
          current.workspaceId !== this.context.workspaceId ||
          current.projectId !== material.projectId
        )
          throw new DomainError("VERSION_CONFLICT");
        const project = await s.ports.work.get(current.projectId);
        if (project.type !== "PROJECT" || project.deletedAt)
          throw new DomainError("NOT_FOUND");
        if (
          current.size !== bytes.size ||
          current.title !== input.name ||
          (current.mime ?? "application/octet-stream") !== input.mime
        )
          throw new DomainError("VALIDATION_ERROR");
        return s.files.uploadWithStableId(this.context, id, input, bytes);
      },
      (result) => ({
        name: "file.upload",
        input: localDto({
          id: result.id,
          input,
          contentHash: result.contentHash,
          size: result.size,
        }),
      }),
    );
    try {
      await this.link(
        { kind: "WORK", id: material.projectId },
        { kind: "FILE", id },
        "REFERENCES",
      );
    } catch (cause) {
      throw new FileProjectLinkError(file, cause);
    }
    return file;
  }
  deleteFile(id: string, version: number, deleted: boolean) {
    return this.workspace.run(
      (s) => s.files.setDeleted(this.context, id, version, deleted),
      () => ({
        name: "file.delete",
        input: localDto({ id, version, deleted }),
      }),
    );
  }
  setFilePolicy(
    id: string,
    version: number,
    policy: import("./content-policy").ContentPolicy,
  ) {
    const captured = structuredClone(policy);
    return this.workspace.run(
      (s) => s.files.setPolicy(this.context, id, version, captured),
      () => ({
        name: "file.policy",
        input: localDto({ id, version, aiPolicy: captured }),
      }),
    );
  }
  readFileBytes(id: string) {
    return this.readLocalSnapshot(() =>
      this.workspace.run((s) => s.files.originalBytes(this.context, id)),
    );
  }
  readFile(actor: ActorContext, id: string) {
    const captured = Object.freeze({ ...actor });
    return this.readLocalSnapshot(() =>
      this.workspace.run((s) => s.files.read(captured, id)),
    );
  }
  private async readLocalSnapshot<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof LocalReadSnapshotChangedError) || attempt >= 2)
          throw error;
      }
    }
  }

  activity() {
    return this.workspace.run((s) => s.ports.activity());
  }
  noteBacklinks(id: string, resolve: NoteWikiResolver) {
    return this.readLocalSnapshot(() =>
      this.workspace.run(
        async (s) => {
          await s.library.read(this.context, id);
          if (!s.ports.library.listMetadata)
            throw new Error("LOCAL_LIBRARY_PORT_INCOMPLETE");
          const captures = [];
          const resolvedNoteIds: string[] = [];
          if (!s.ports.notes.listMetadata)
            throw new Error("LOCAL_NOTE_PORT_INCOMPLETE");
          for (const manifest of await s.ports.notes.listMetadata()) {
            if (manifest.deletedAt) continue;
            try {
              captures.push(await s.ports.notes.get(manifest.id));
              resolvedNoteIds.push(manifest.id);
            } catch (error) {
              if (!(error instanceof LocalBodyUnavailableError)) throw error;
            }
          }
          if (!captures.length) return { references: [], resolvedNoteIds };
          const references = noteWikiReferences(
            captures,
            await s.ports.library.listMetadata(),
            resolve,
          );
          return {
            references: references.filter(
              (value) => value.targetDocumentId === id,
            ),
            resolvedNoteIds,
          };
        },
        undefined,
        true,
      ),
    );
  }

  subscribeWorkspace(listener: () => void) {
    return this.workspace.subscribe(listener);
  }

  searchNotes(query: string) {
    return this.workspace.run((s) => {
      if (!s.ports.notes.searchIds)
        throw new Error("LOCAL_SEARCH_PORT_INCOMPLETE");
      return s.ports.notes.searchIds(query);
    });
  }
  searchLibrary(query: string, spaceId: string) {
    return this.workspace.run(async (s) => {
      if (!s.ports.library.searchIds || !s.ports.library.listMetadata)
        throw new Error("LOCAL_SEARCH_PORT_INCOMPLETE");
      const ids = new Set(await s.ports.library.searchIds(query));
      return (await s.ports.library.listMetadata())
        .filter(
          (value) =>
            !value.deletedAt &&
            value.kind === "DOCUMENT" &&
            (!spaceId || value.spaceId === spaceId) &&
            ids.has(value.id),
        )
        .map((value) => ({
          id: value.id,
          title: value.title,
          spaceId: value.spaceId!,
          score: 1,
        }));
    });
  }
  loadImage(path: string) {
    if (!/^\/api\/library\/asset\?id=[a-zA-Z0-9-]+$/.test(path))
      throw new DomainError("VALIDATION_ERROR");
    const id = path.slice("/api/library/asset?id=".length);
    return this.workspace.run((s) => s.ports.images.readImage(id));
  }

  uploadImageChunk(asset: LibraryAsset, index: number, final: boolean) {
    return this.workspace.run((s) =>
      s.ports.images.putAssetChunk(asset, index, final),
    );
  }

  saveNote(id: string | null, version: number, input: NoteInput) {
    const captured = structuredClone(input);
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) => s.notes.save(this.context, id, version, captured),
        (result) => ({
          name: "note.save",
          input: localDto({
            id: result.id,
            version,
            create: id === null,
            input: captured,
          }),
        }),
      ),
    );
  }
  deleteNote(id: string, version: number, deleted: boolean) {
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) => s.notes.setDeleted(this.context, id, version, deleted),
        () => ({
          name: "note.delete",
          input: localDto({ id, version, deleted }),
        }),
      ),
    );
  }
  purgeNote(id: string, version: number) {
    return this.workspace.run(
      (s) => s.notes.purge(this.context, id, version),
      () => ({ name: "note.purge", input: localDto({ id, version }) }),
    );
  }
  revisions(id: string) {
    return this.workspace.run((s) => s.notes.revisions(this.context, id));
  }
  moveLibraryDocument(id: string, version: number, spaceId: string) {
    return this.workspace.run(
      (s) => s.library.moveDocument(this.context, id, version, spaceId),
      () => ({
        name: "library.move",
        input: localDto({ id, version, spaceId }),
      }),
    );
  }
  saveLibrary(id: string | null, version: number, input: LibraryInput) {
    const captured = structuredClone(input);
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) => s.library.save(this.context, id, version, captured),
        (result) => ({
          name: "library.save",
          input: localDto({
            id: result.id,
            version,
            create: id === null,
            input: captured,
          }),
        }),
      ),
    );
  }
  private async restartAbortedWorkspaceWrite<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (
          attempt >= 2 ||
          !(error instanceof LocalStorageError) ||
          error.code !== "VERSION_CONFLICT" ||
          error.conflict?.collection !== "$local.workspace" ||
          error.conflict.entityId !== "revision"
        )
          throw error;
      }
    }
  }
  restoreNoteAndSave(id: string, version: number, input: NoteInput) {
    const captured = structuredClone(input);
    return this.workspace.run(
      (s) => s.notes.restoreAndSave(this.context, id, version, captured),
      () => ({
        name: "note.restore",
        input: localDto({ id, version, create: false, input: captured }),
      }),
    );
  }
  restoreLibraryAndSave(id: string, version: number, input: LibraryInput) {
    const captured = structuredClone(input);
    return this.workspace.run(
      (s) => s.library.restoreAndSave(this.context, id, version, captured),
      () => ({
        name: "library.restore",
        input: localDto({ id, version, create: false, input: captured }),
      }),
    );
  }
  deleteLibrary(id: string, version: number, deleted: boolean) {
    return this.workspace.run(
      (s) => s.library.setDeleted(this.context, id, version, deleted),
      () => ({
        name: "library.delete",
        input: localDto({ id, version, deleted }),
      }),
    );
  }
  purgeLibrary(id: string, version: number) {
    return this.workspace.run(
      (s) => s.library.purge(this.context, id, version),
      () => ({ name: "library.purge", input: localDto({ id, version }) }),
    );
  }
  libraryRevisions(id: string) {
    return this.workspace.run((s) => s.library.revisions(this.context, id));
  }
  saveReminder(
    id: string | null,
    version: number,
    input: ReminderInput,
    deleted = false,
  ) {
    const captured = structuredClone(input);
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) => s.reminders.save(this.context, id, version, captured, deleted),
        (result) => ({
          name: "reminder.save",
          input: localDto({
            id: result.id,
            version,
            create: id === null,
            input: captured,
            deleted,
          }),
        }),
      ),
    );
  }
  createProjectSpace(
    input: Parameters<ProjectService["createProjectSpace"]>[1],
  ) {
    const captured = structuredClone(input);
    return this.workspace.run(
      (s) => s.projects.createProjectSpace(this.context, captured),
      (result) => ({
        name: "project.space.create",
        input: localDto({
          materialId: result.id,
          targetId: result.spaceId,
          input: captured,
        }),
      }),
    );
  }
  linkProjectSpace(input: Parameters<ProjectService["linkProjectSpace"]>[1]) {
    const captured = structuredClone(input);
    return this.workspace.run(
      (s) => s.projects.linkProjectSpace(this.context, captured),
      (result) => ({
        name: "project.space.link",
        input: localDto({ materialId: result.id, input: captured }),
      }),
    );
  }
  async createProjectDocument(
    input: Parameters<ProjectService["createProjectDocument"]>[1],
  ) {
    const captured = structuredClone(input);
    const result = await this.workspace.run(
      async (s) => {
        const document = await s.projects.createProjectDocument(
          this.context,
          captured,
        );
        const materials = (await s.ports.projects.list()).filter(
          (value) =>
            value.projectId === captured.projectId &&
            value.kind === "DOCUMENT" &&
            value.targetId === document.id &&
            value.ownership === "OWNED" &&
            !value.deletedAt,
        );
        const material = materials[0];
        if (materials.length !== 1 || !material)
          throw new DomainError("VERSION_CONFLICT");
        return { document, materialId: material.id };
      },
      (result) => ({
        name: "project.document.create",
        input: localDto({
          materialId: result.materialId,
          targetId: result.document.id,
          input: captured,
        }),
      }),
    );
    return result.document;
  }
  projectDelete(id: string, version: number, deleted: boolean) {
    return this.workspace.run(
      (s) => s.projects.setDeleted(this.context, id, version, deleted),
      () => ({
        name: "project.material.delete",
        input: localDto({ id, version, deleted }),
      }),
    );
  }
  projectActivity(projectId: string) {
    return this.workspace.run((s) => s.ports.projects.activity(projectId));
  }
  saveCategory(input: Parameters<CategoryService["save"]>[1]) {
    const captured = structuredClone(input);
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) => s.categories.save(this.context, captured),
        (result) => ({
          name: "category.save",
          input: localDto({
            id: result.id,
            create: !captured.id,
            input: captured,
          }),
        }),
      ),
    );
  }
  reorderCategories(ordered: Parameters<CategoryService["reorder"]>[1]) {
    const captured = structuredClone(ordered);
    return this.workspace.run(
      (s) => s.categories.reorder(this.context, captured),
      () => ({
        name: "category.reorder",
        input: localDto({ ordered: captured }),
      }),
    );
  }
  moveManualOrder(input: Parameters<ManualOrderService["move"]>[1]) {
    const captured = structuredClone(input);
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) => s.orders.move(this.context, captured),
        () => ({ name: "manual-order.move", input: localDto(captured) }),
      ),
    );
  }
  organize(input: OrganizeInput) {
    const captured = structuredClone(input);
    return this.workspace.run(
      (s) => s.organization.apply(this.context, captured),
      () => ({ name: "organization.apply", input: localDto(captured) }),
    );
  }
  saveTaskRecurrence(
    input: Parameters<WorkflowService["saveTaskRecurrence"]>[1],
  ) {
    const captured = structuredClone(input);
    return this.workspace.run(
      (s) => s.workflows.saveTaskRecurrence(this.context, captured),
      (result) => ({
        name: "recurrence.task",
        input: localDto({
          definitionId: result.definition.id,
          input: captured,
        }),
      }),
    );
  }
  saveRecurrence(input: Parameters<WorkflowService["saveRecurrence"]>[1]) {
    const captured = structuredClone(input);
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) => s.workflows.saveRecurrence(this.context, captured),
        (result) => ({
          name: "recurrence.save",
          input: localDto({ definitionId: result.id, input: captured }),
        }),
      ),
    );
  }
  generateRecurrence(id: string, version: number, from: string, to: string) {
    return this.workspace.run(
      (s) => s.workflows.generate(this.context, id, version, from, to),
      () => ({
        name: "recurrence.generate",
        input: localDto({ id, version, from, to }),
      }),
    );
  }
  skipOccurrence(id: string, version: number) {
    return this.workspace.run(
      (s) => s.workflows.skipOccurrence(this.context, id, version),
      () => ({ name: "recurrence.skip", input: localDto({ id, version }) }),
    );
  }
  backfillOccurrence(id: string, version: number, completedAt: string | null) {
    return this.workspace.run(
      (s) => s.workflows.backfill(this.context, id, version, completedAt),
      () => ({
        name: "recurrence.backfill",
        input: localDto({ id, version, completedAt }),
      }),
    );
  }
  previewPlan(projectId: string | null, manifest: unknown) {
    const captured = structuredClone(manifest);
    return this.workspace.run(
      (s) => s.workflows.preview(this.context, projectId, captured),
      (result) => {
        if (result.payload.kind !== "PLAN")
          throw new DomainError("VERSION_CONFLICT");
        return {
          name: "plan.preview",
          input: localDto({
            id: result.id,
            projectId,
            manifest: captured,
            baseRevision: result.payload.baseRevision,
            documentRevision: result.payload.documentRevision ?? "",
          }),
        };
      },
    );
  }
  publishPlan(id: string, version: number) {
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) => s.workflows.publish(this.context, id, version),
        () => ({ name: "plan.publish", input: localDto({ id, version }) }),
      ),
    );
  }
  promoteNote(
    id: string,
    version: number,
    spaceId: string,
    archiveSourceNote: boolean,
    parentDocumentId: string | null = null,
  ) {
    const input = { spaceId, archiveSourceNote, parentDocumentId };
    return this.workspace
      .run(
        async (s) => {
          const document = await s.noteKnowledge.promoteNoteToDocument(
            this.context,
            id,
            version,
            input,
          );
          const links = (await s.ports.connected.links()).filter(
            (link) =>
              !link.deletedAt &&
              link.from.kind === "NOTE" &&
              link.from.id === id &&
              link.to.kind === "DOCUMENT" &&
              link.to.id === document.id &&
              link.relation === "REFERENCES",
          );
          if (links.length !== 1) throw new DomainError("VERSION_CONFLICT");
          return { document, linkId: links[0]!.id };
        },
        (result) => ({
          name: "note.document.promote",
          input: localDto({
            id,
            version,
            input,
            documentId: result.document.id,
            linkId: result.linkId,
          }),
        }),
      )
      .then((result) => result.document);
  }
  linkNoteToSpace(id: string, version: number, spaceId: string) {
    return this.workspace.run(
      (s) =>
        s.noteKnowledge.linkNoteToSpace(this.context, id, version, spaceId),
      (result) => ({
        name: "note.space.link",
        input: localDto({ id, version, spaceId, linkId: result.id }),
      }),
    );
  }
  link(from: EntityRef, to: EntityRef, relation: KnowledgeLink["relation"]) {
    const captured = structuredClone({ from, to, relation });
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) =>
          s.connected.link(
            this.context,
            captured.from,
            captured.to,
            captured.relation,
          ),
        (result) => ({
          name: "link.create",
          input: localDto({ id: result.id, ...captured }),
        }),
      ),
    );
  }
  unlink(id: string, version: number) {
    return this.restartAbortedWorkspaceWrite(() =>
      this.workspace.run(
        (s) => s.connected.unlink(this.context, id, version),
        () => ({ name: "link.delete", input: localDto({ id, version }) }),
      ),
    );
  }

  async readDocumentBody(
    entry: WorkspaceNote | WorkspaceLibraryEntry,
  ): Promise<Note | LibraryEntry> {
    if (entry.workspaceId !== this.context.workspaceId)
      throw new DomainError("NOT_FOUND");
    // Always consult durable storage: a caller's hydrated object can be stale.
    const value = await this.readLocalSnapshot(() =>
      this.workspace.run<Note | LibraryEntry>((services) =>
        entry.kind === "NOTE" || entry.kind === "JOURNAL"
          ? services.notes.read(this.context, entry.id, !!entry.deletedAt)
          : services.library.read(this.context, entry.id, !!entry.deletedAt),
      ),
    );
    if (value.kind !== entry.kind || value.version < entry.version)
      throw new DomainError("VERSION_CONFLICT");
    return value;
  }
}
