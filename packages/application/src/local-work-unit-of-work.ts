import {
  type ActorContext,
  DomainError,
  defaultNavigationPreference,
  normalizeNavigationPreference,
  type WorkEdge,
  type WorkItem,
} from "@arclattice/domain";
import type { ConnectedStore } from "./connected";
import type { EntityMemoTransaction } from "./entity-memos";
import type { LibraryFileStore } from "./files";
import type {
  ActivityEvent,
  CalendarSettings,
  Clock,
  IdGenerator,
  UnitOfWork,
  WorkTransaction,
} from "./index";
import type { LibraryStore } from "./library";
import type { LocalCommandIntent } from "./local-command";
import { LocalConnectedStore } from "./local-connected-store";
import { localDto, localObject } from "./local-dto";
import { localEntityMemoTransaction } from "./local-entity-memos";
import { LocalFileStore } from "./local-file-store";
import {
  type LocalLibraryAssets,
  LocalLibraryStore,
  type LocalWikiIndexer,
} from "./local-library-store";
import { LocalMutationTransaction } from "./local-mutation-transaction";
import { LocalNotebookStore } from "./local-notebook-store";
import type { LocalEntity, LocalMetadataStore } from "./local-persistence";
import { LocalProjectStore } from "./local-project-store";
import { LocalRecordRepository } from "./local-record-repository";
import type { NotebookStore } from "./notebook";
import type { OrganizationStore } from "./organization";
import type { ProjectStore } from "./project-materials";
import { normalizeWorkflowRecords } from "./recurrence-lifecycle";
import type {
  WorkspaceChange,
  WorkspaceChangePage,
} from "./workspace-change-log";

export interface LocalDataPorts {
  memos: EntityMemoTransaction;
  recordCommand(intent: LocalCommandIntent): void;
  files: LibraryFileStore;
  activity(): Promise<ActivityEvent[]>;
  work: WorkTransaction;
  notes: NotebookStore;
  library: LibraryStore;
  connected: ConnectedStore;
  projects: ProjectStore;
  organization: OrganizationStore;
  images: LocalLibraryAssets;
}

/** Existing WorkService runs here unchanged. All writes use one durable commit. */
export class LocalWorkUnitOfWork implements UnitOfWork {
  constructor(
    private readonly store: LocalMetadataStore,
    private readonly actor: ActorContext,
    private readonly deviceId: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    return this.runWithNotebook(workspaceId, (tx) => operation(tx));
  }

  async runWithNotebook<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction, notes: NotebookStore) => T | Promise<T>,
  ): Promise<T> {
    return this.runStaged(workspaceId, (tx, stage, publish) =>
      operation(
        tx,
        new LocalNotebookStore(
          stage,
          this.actor,
          this.clock,
          this.ids,
          publish,
        ),
      ),
    );
  }

  async runWithLibrary<T>(
    workspaceId: string,
    indexer: LocalWikiIndexer,
    assets: (
      stage: LocalMutationTransaction,
      publish: (change: Omit<WorkspaceChange, "seq">) => void,
    ) => LocalLibraryAssets,
    operation: (
      tx: WorkTransaction,
      notes: NotebookStore,
      library: LibraryStore,
    ) => T | Promise<T>,
  ): Promise<T> {
    return this.runWithPorts(workspaceId, indexer, assets, (ports) =>
      operation(ports.work, ports.notes, ports.library),
    );
  }

  async runWithPorts<T>(
    workspaceId: string,
    indexer: LocalWikiIndexer,
    assets: (
      stage: LocalMutationTransaction,
      publish: (change: Omit<WorkspaceChange, "seq">) => void,
    ) => LocalLibraryAssets,
    operation: (ports: LocalDataPorts) => T | Promise<T>,
    readProjection = false,
    onValidated?: (revision: number | null) => void,
  ): Promise<T> {
    return this.runStaged(
      workspaceId,
      (tx, stage, publish) => {
        const records = new LocalRecordRepository(
          stage,
          this.actor,
          this.clock,
          this.ids,
          publish,
        );
        const images = assets(stage, publish);
        return operation({
          memos: localEntityMemoTransaction(stage, this.actor, (change) =>
            publish({
              workspaceId,
              collection: "entityMemos",
              entityId: change.memoId,
              version: change.version,
              op: "UPSERT",
            }),
          ),
          recordCommand: (intent) => stage.recordCommand(intent),
          files: new LocalFileStore(records, this.store.fileExtractions),
          activity: async () =>
            (await stage.list("$local.activity")).map((entity) => {
              const value = localObject(entity.value);
              if (
                value.workspaceId !== workspaceId ||
                typeof value.principalId !== "string" ||
                typeof value.entityId !== "string" ||
                typeof value.type !== "string" ||
                typeof value.occurredAt !== "string"
              )
                throw new Error("LOCAL_DATA_CORRUPT");
              return structuredClone(value) as unknown as ActivityEvent;
            }),
          work: tx,
          notes: new LocalNotebookStore(
            stage,
            this.actor,
            this.clock,
            this.ids,
            publish,
          ),
          library: new LocalLibraryStore(
            stage,
            this.actor,
            this.clock,
            this.ids,
            publish,
            indexer,
            images,
            readProjection,
          ),
          connected: new LocalConnectedStore(records, stage),
          projects: new LocalProjectStore(records, stage),
          organization: {
            list: () => tx.organizations(),
            save: (value, expected) => tx.saveOrganization(value, expected),
          },
          images,
        });
      },
      readProjection,
      onValidated,
    );
  }

  private async runStaged<T>(
    workspaceId: string,
    operation: (
      tx: WorkTransaction,
      stage: LocalMutationTransaction,
      publish: (change: Omit<WorkspaceChange, "seq">) => void,
    ) => T | Promise<T>,
    readProjection = false,
    onValidated?: (revision: number | null) => void,
  ): Promise<T> {
    if (workspaceId !== this.actor.workspaceId)
      throw new DomainError("FORBIDDEN");
    if (onValidated && !readProjection) throw new DomainError("FORBIDDEN");
    const stage = await LocalMutationTransaction.begin(
      this.store,
      this.actor,
      this.deviceId,
      this.clock,
      this.ids,
      readProjection,
    );
    const changes: WorkspaceChange[] = [];
    const decode = <V>(entity: LocalEntity): V => {
      const value = localObject(entity.value);
      if (
        entity.workspaceId !== workspaceId ||
        (value.workspaceId !== undefined &&
          value.workspaceId !== workspaceId) ||
        (!entity.collection.startsWith("$local.") &&
          value.version !== undefined &&
          value.version !== entity.version)
      )
        throw new Error("LOCAL_DATA_CORRUPT");
      // All decode inputs came from stage.get/list, which already detach values.
      return value as V;
    };
    const list = async <V>(collection: string): Promise<V[]> =>
      (await stage.list(collection))
        .filter((entity) => localObject(entity.value).localTombstone !== true)
        .map((entity) => decode<V>(entity));
    const getRecord = async (collection: string, id: string) => {
      const entity = await stage.get(collection, id);
      return entity && localObject(entity.value).localTombstone !== true
        ? entity
        : null;
    };
    const internal = async (collection: string, id: string, value: unknown) => {
      const old = await stage.get(collection, id);
      stage.stageInternal(
        {
          workspaceId,
          collection,
          id,
          version: (old?.version ?? 0) + 1,
          value: localDto(value),
        },
        old?.version ?? null,
      );
    };
    const save = async (
      collection: string,
      id: string,
      value: unknown,
      expected: number,
    ) => {
      const data = localObject(localDto(value));
      if (data.workspaceId !== undefined && data.workspaceId !== workspaceId)
        throw new DomainError("FORBIDDEN");
      if (
        data.updatedBy !== undefined &&
        data.updatedBy !== this.actor.principalId
      )
        throw new DomainError("FORBIDDEN");
      const old = await stage.get(collection, id);
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        (old?.version ?? 0) !== expected ||
        data.version !== expected + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      stage.stage(
        { workspaceId, collection, id, version: expected + 1, value: data },
        old?.version ?? null,
        old ? "PATCH" : "CREATE",
        data,
        old?.value ?? null,
      );
      changes.push({
        seq: 0,
        workspaceId,
        collection,
        entityId: id,
        op: "UPSERT",
        version: expected + 1,
      });
    };
    const remove = async (collection: string, id: string, expected: number) => {
      const old = await getRecord(collection, id);
      if (!old) throw new DomainError("NOT_FOUND");
      if (old.version !== expected) throw new DomainError("VERSION_CONFLICT");
      const value = { localTombstone: true };
      stage.stage(
        { workspaceId, collection, id, version: expected + 1, value },
        expected,
        "DELETE",
        value,
        old.value,
      );
      changes.push({
        seq: 0,
        workspaceId,
        collection,
        entityId: id,
        op: "DELETE",
        version: expected + 1,
      });
    };
    const get = async (id: string): Promise<WorkItem> => {
      const entity = await getRecord("items", id);
      if (!entity) throw new DomainError("NOT_FOUND");
      const item = decode<WorkItem>(entity);
      if (
        typeof item.title !== "string" ||
        typeof item.descriptionMd !== "string" ||
        (typeof item.deletedAt !== "string" && item.deletedAt !== null)
      )
        throw new Error("LOCAL_DATA_CORRUPT");
      return item.type === "TASK"
        ? { ...item, projectIds: item.projectIds ?? [] }
        : item;
    };
    const page = async (
      after: number,
      epoch?: string,
    ): Promise<WorkspaceChangePage> => {
      if (!Number.isSafeInteger(after) || after < 0)
        throw new DomainError("VALIDATION_ERROR");
      const cursorEntity = await stage.get("$local.changes", "cursor");
      const cursor = cursorEntity ? localObject(cursorEntity.value).seq : 0;
      if (
        typeof cursor !== "number" ||
        !Number.isSafeInteger(cursor) ||
        cursor < 0
      )
        throw new Error("LOCAL_DATA_CORRUPT");
      const localEpoch = "local:" + workspaceId;
      const recovery = after > cursor || (!!epoch && epoch !== localEpoch);
      const entries = recovery
        ? []
        : (await list<WorkspaceChange>("$local.changeLog"))
            .filter((value) => value.seq > after)
            .sort((a, b) => a.seq - b.seq)
            .slice(0, 500);
      return {
        epoch: localEpoch,
        cursor: entries.at(-1)?.seq ?? cursor,
        changes: entries,
        recovery,
        hasMore: !recovery && after + entries.length < cursor,
      };
    };
    const tx: WorkTransaction = {
      workspaceChanges: page,
      workspaceEntity: async (collection, id) => {
        const allowed = new Set([
          "items",
          "edges",
          "categories",
          "workflows",
          "organization",
          "reminders",
          "navigationPreference",
          "calendarSettings",
          "manualOrders",
        ]);
        if (!allowed.has(collection)) throw new DomainError("VALIDATION_ERROR");
        const entity = await getRecord(collection, id);
        return entity ? decode(entity) : null;
      },
      workspaceRelatedLinks: async (kind, id) =>
        (await list<import("./connected").KnowledgeLink>("links")).filter(
          (link) =>
            (link.from.kind === kind && link.from.id === id) ||
            (link.to.kind === kind && link.to.id === id),
        ),
      reminders: () => list("reminders"),
      saveReminder: async (value, expected) => {
        await save("reminders", value.id, value, expected);
        await internal("$local.reminderActivity", this.ids.next(), {
          entityId: value.id,
          version: value.version,
          principalId: this.actor.principalId,
          occurredAt: value.updatedAt,
        });
      },
      organizations: () => list("organization"),
      saveOrganization: (value, expected) =>
        save("organization", value.kind + ":" + value.id, value, expected),
      navigationPreference: async (principalId) => {
        if (principalId !== this.actor.principalId)
          throw new DomainError("FORBIDDEN");
        const entity = await getRecord("navigationPreference", principalId);
        return normalizeNavigationPreference(
          entity ? decode(entity) : defaultNavigationPreference(),
        );
      },
      saveNavigationPreference: async (principalId, value, expected) => {
        if (principalId !== this.actor.principalId)
          throw new DomainError("FORBIDDEN");
        await save("navigationPreference", principalId, value, expected);
      },
      calendarSettings: async () => {
        const entity = await getRecord("calendarSettings", "workspace");
        return entity
          ? decode<CalendarSettings>(entity)
          : { version: 0, timezone: null };
      },
      saveCalendarSettings: (value, expected) =>
        save("calendarSettings", "workspace", value, expected),
      workflows: async () => normalizeWorkflowRecords(await list("workflows")),
      saveWorkflow: async (value, expected) => {
        const old = await getRecord("workflows", value.id);
        if (old) {
          const previous = decode<import("./workflows").WorkflowRecord>(old);
          if (
            previous.createdBy !== value.createdBy ||
            previous.createdAt !== value.createdAt ||
            previous.payload.kind !== value.payload.kind
          )
            throw new DomainError("VALIDATION_ERROR");
        }
        await save("workflows", value.id, value, expected);
        await internal("$local.workflowActivity", this.ids.next(), {
          entityId: value.id,
          version: value.version,
          principalId: this.actor.principalId,
          occurredAt: value.updatedAt,
        });
      },
      categories: () => list("categories"),
      manualOrders: () => list("manualOrders"),
      saveManualOrder: (value, expected) =>
        save("manualOrders", value.id, value, expected),
      saveCategory: (value, expected) =>
        save("categories", value.id, value, expected),
      appendCategoryChange: async (value) => {
        if (
          value.workspaceId !== workspaceId ||
          value.principalId !== this.actor.principalId
        )
          throw new DomainError("FORBIDDEN");
        await internal("$local.categoryActivity", value.id, value);
      },
      list: async (includeDeleted = false) =>
        (await list<WorkItem>("items"))
          .filter((item) => includeDeleted || !item.deletedAt)
          .map((item) =>
            item.type === "TASK"
              ? { ...item, projectIds: item.projectIds ?? [] }
              : item,
          ),
      get,
      edges: () => list("edges"),
      insert: (value) => save("items", value.id, value, 0),
      replace: (value, expected) => save("items", value.id, value, expected),
      purge: async (id, expected) => {
        const item = await get(id);
        if (!item.deletedAt) throw new DomainError("VALIDATION_ERROR");
        if (item.version !== expected)
          throw new DomainError("VERSION_CONFLICT");
        for (const edge of await list<WorkEdge>("edges"))
          if (edge.fromId === id || edge.toId === id)
            await tx.removeEdge(edge.id);
        await new LocalRecordRepository(
          stage,
          this.actor,
          this.clock,
          this.ids,
          (change) => changes.push({ ...change, seq: 0 }),
        ).purgeRelations({ kind: "WORK", id });
        await remove("items", id, expected);
      },
      addEdge: async (value) => {
        if (await stage.get("edges", value.id))
          throw new DomainError("DUPLICATE_EDGE");
        if (
          (await get(value.fromId)).deletedAt ||
          (await get(value.toId)).deletedAt
        )
          throw new DomainError("NOT_FOUND");
        await save("edges", value.id, { ...value, version: 1 }, 0);
      },
      removeEdge: async (id) => {
        const edge = await getRecord("edges", id);
        if (!edge) throw new DomainError("NOT_FOUND");
        await remove("edges", id, edge.version);
      },
      appendActivity: async (value) => {
        if (
          value.workspaceId !== workspaceId ||
          value.principalId !== this.actor.principalId
        )
          throw new DomainError("FORBIDDEN");
        await internal("$local.activity", value.id, value);
      },
      appendOutbox: async (value) => {
        if (value.workspaceId !== workspaceId)
          throw new DomainError("FORBIDDEN");
        await internal("$local.domainOutbox", value.id, value);
      },
    };
    try {
      const result = stage.detachResult(
        await operation(tx, stage, (change) =>
          changes.push({ ...change, seq: 0 }),
        ),
      );
      if (changes.length) {
        const cursor = await stage.get("$local.changes", "cursor");
        const start = cursor ? localObject(cursor.value).seq : 0;
        if (
          typeof start !== "number" ||
          !Number.isSafeInteger(start) ||
          start < 0
        )
          throw new Error("LOCAL_DATA_CORRUPT");
        for (const [index, change] of changes.entries())
          await internal("$local.changeLog", String(start + index + 1), {
            ...change,
            seq: start + index + 1,
          });
        await internal("$local.changes", "cursor", {
          seq: start + changes.length,
        });
      }
      await stage.commit();
      onValidated?.(stage.validatedRevision());
      return result;
    } catch (error) {
      stage.abort();
      throw error;
    }
  }
}
