import { type ActorContext, DomainError } from "@arclattice/domain";
import { CategoryService } from "./categories";
import { ConnectedService } from "./connected";
import { type EntityMemoIdentity, EntityMemoService } from "./entity-memos";
import { FileService } from "./files";
import {
  type AuthorizationService,
  type Clock,
  type IdGenerator,
  type Permission,
  type UnitOfWork,
  WorkService,
} from "./index";
import { LibraryService } from "./library";
import { exportLocalWorkspace } from "./local-backup";
import type { LocalCommandIntent } from "./local-command";
import { localObject } from "./local-dto";
import { LocalImageAssets } from "./local-image-assets";
import type { LocalWikiIndexer } from "./local-library-store";
import type {
  LocalBlobStore,
  LocalMetadataStore,
  LocalWorkspaceIdentity,
} from "./local-persistence";
import {
  type LocalDataPorts,
  LocalWorkUnitOfWork,
} from "./local-work-unit-of-work";
import { ManualOrderService } from "./manual-order";
import { NoteKnowledgeService } from "./note-knowledge";
import { NotebookService } from "./notebook";
import { OrganizationService } from "./organization";
import { planDocumentPublisher } from "./plan-documents";
import { ProjectService } from "./project-materials";
import { ReminderService } from "./reminders";
import { WorkflowService } from "./workflows";
import type {
  WorkspaceBootstrap,
  WorkspaceLibraryEntry,
  WorkspaceNote,
} from "./workspace-bootstrap";

export interface LocalServices {
  readonly files: FileService;
  readonly context: ActorContext;
  readonly work: WorkService;
  readonly notes: NotebookService;
  readonly library: LibraryService;
  readonly projects: ProjectService;
  readonly reminders: ReminderService;
  readonly categories: CategoryService;
  readonly orders: ManualOrderService;
  readonly workflows: WorkflowService;
  readonly connected: ConnectedService;
  readonly noteKnowledge: NoteKnowledgeService;
  readonly organization: OrganizationService;
  readonly ports: LocalDataPorts;
}
export type LocalWorkspaceSnapshot = WorkspaceBootstrap["workspace"] & {
  notes: WorkspaceNote[];
  library: WorkspaceLibraryEntry[];
};

/** Durable Application composition. No server session, HTTP, framework or Rust rules. */
export class LocalWorkspace {
  async revision(): Promise<number | null> {
    const row = await this.store.get(
      this.context.workspaceId,
      "$local.workspace",
      "revision",
    );
    if (!row) return null;
    if (
      row.workspaceId !== this.context.workspaceId ||
      row.collection !== "$local.workspace" ||
      row.id !== "revision" ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1 ||
      localObject(row.value).revision !== row.version
    )
      throw new Error("LOCAL_DATA_CORRUPT");
    return row.version;
  }
  backup() {
    return exportLocalWorkspace(
      this.context.workspaceId,
      this.store,
      this.blobs,
    );
  }
  readonly identity: LocalWorkspaceIdentity;
  readonly context: ActorContext;
  private readonly uow: LocalWorkUnitOfWork;
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly store: LocalMetadataStore,
    private readonly blobs: LocalBlobStore,
    identity: LocalWorkspaceIdentity,
    private readonly wiki: LocalWikiIndexer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.identity = Object.freeze({ ...identity });
    this.context = Object.freeze({
      workspaceId: identity.workspaceId,
      principalId: identity.principalId,
    });
    this.uow = new LocalWorkUnitOfWork(
      store,
      this.context,
      identity.deviceId,
      clock,
      ids,
    );
    const permissions: readonly Permission[] = [
      "work:read",
      "work:create",
      "work:update",
      "work:delete",
      "graph:write",
    ];
    this.authorization = {
      require: async (context, permission) => {
        if (
          context.workspaceId !== this.context.workspaceId ||
          context.principalId !== this.context.principalId ||
          !permissions.includes(permission)
        )
          throw new DomainError("FORBIDDEN");
      },
    };
    this.images = (stage, publish) =>
      new LocalImageAssets(stage, blobs, this.context, clock, ids, publish);
  }
  private readonly images: Parameters<LocalWorkUnitOfWork["runWithPorts"]>[2];

  subscribe(listener: () => void) {
    if (!this.store.subscribe)
      throw new Error("LOCAL_INVALIDATION_PORT_INCOMPLETE");
    return this.store.subscribe(this.context.workspaceId, listener);
  }

  runEntityMemos<T>(
    identity: EntityMemoIdentity,
    operation: (
      service: EntityMemoService,
      services: LocalServices,
    ) => Promise<T>,
    capture?: (result: T) => LocalCommandIntent,
  ): Promise<T> {
    return this.run(
      (services) =>
        operation(
          new EntityMemoService(
            {
              run: async (actor, callback) => {
                await this.authorization.require(actor, "work:read");
                return callback(services.ports.memos);
              },
            },
            this.authorization,
            this.clock,
            identity,
          ),
          services,
        ),
      capture,
    );
  }

  run<T>(
    operation: (services: LocalServices) => T | Promise<T>,
    capture?: (result: T) => LocalCommandIntent,
    readProjection = false,
    onValidated?: (revision: number | null) => void,
  ): Promise<T> {
    return this.uow.runWithPorts(
      this.context.workspaceId,
      this.wiki,
      this.images,
      async (ports) => {
        const scoped: UnitOfWork = {
          run: async (workspaceId, callback) => {
            if (workspaceId !== this.context.workspaceId)
              throw new DomainError("FORBIDDEN");
            return callback(ports.work);
          },
        };
        const work = new WorkService(
          scoped,
          this.authorization,
          this.clock,
          this.ids,
        );
        const notes = new NotebookService(
          ports.notes,
          this.authorization,
          this.clock,
          this.ids,
        );
        const result = await operation({
          files: new FileService(
            ports.files,
            ports.library,
            this.blobs,
            this.authorization,
            this.clock,
            this.ids,
          ),
          context: this.context,
          work,
          notes,
          library: new LibraryService(
            ports.library,
            this.authorization,
            this.clock,
            this.ids,
          ),
          projects: new ProjectService(
            scoped,
            ports.projects,
            ports.library,
            this.authorization,
            this.clock,
            this.ids,
          ),
          reminders: new ReminderService(
            scoped,
            this.authorization,
            this.clock,
            this.ids,
          ),
          categories: new CategoryService(
            scoped,
            this.authorization,
            this.clock,
            this.ids,
          ),
          orders: new ManualOrderService(
            scoped,
            this.authorization,
            this.clock,
            this.ids,
          ),
          workflows: new WorkflowService(
            scoped,
            this.authorization,
            this.clock,
            this.ids,
            planDocumentPublisher(
              scoped,
              ports.projects,
              ports.library,
              this.authorization,
              this.clock,
              this.ids,
            ),
          ),
          connected: new ConnectedService(
            ports.connected,
            this.authorization,
            this.clock,
            this.ids,
          ),
          noteKnowledge: new NoteKnowledgeService(
            ports.notes,
            ports.library,
            ports.connected,
            this.authorization,
            this.clock,
            this.ids,
          ),
          organization: new OrganizationService(
            ports.organization,
            work,
            notes,
            this.authorization,
            this.clock,
          ),
          ports,
        });
        if (capture) ports.recordCommand(capture(result));
        return result;
      },
      readProjection,
      onValidated,
    );
  }

  async snapshotWithRevision() {
    let revision: number | null | undefined;
    const snapshot = await this.snapshot((value) => {
      revision = value;
    });
    if (revision === undefined)
      throw new Error("LOCAL_TRANSACTION_NOT_VALIDATED");
    return { snapshot, revision };
  }

  snapshot(
    onValidated?: (revision: number | null) => void,
  ): Promise<LocalWorkspaceSnapshot> {
    return this.run(
      async (services) => {
        const context = this.context;
        if (
          !services.ports.library.listMetadata ||
          !services.ports.library.wikiLinks
        )
          throw new Error("LOCAL_LIBRARY_PORT_INCOMPLETE");
        const [
          files,
          work,
          notes,
          library,
          projectMaterials,
          organization,
          links,
          categories,
          workflows,
          reminders,
          wikiLinks,
          manualOrders,
        ] = await Promise.all([
          services.ports.files.list(),
          services.work.snapshot(context, true),
          services.notes.manifest(context),
          services.ports.library.listMetadata(),
          services.ports.projects.list(),
          services.ports.organization.list(),
          services.ports.connected.links(),
          services.categories.list(context),
          services.ports.work.workflows(),
          services.reminders.list(context),
          services.ports.library.wikiLinks(),
          services.orders.list(context),
        ]);
        return {
          files,
          ...work,
          notes,
          library,
          projectMaterials,
          organization,
          links,
          categories,
          workflows,
          reminders,
          wikiLinks,
          manualOrders,
        };
      },
      undefined,
      true,
      onValidated,
    );
  }
}
