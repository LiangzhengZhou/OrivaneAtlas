import type {
  ActivityEvent,
  AuthorizationService,
  CalendarSettings,
  CategoryChange,
  OutboxEvent,
  Permission,
  ProjectCategory,
  UnitOfWork,
  WorkflowRecord,
  WorkTransaction,
} from "@arclattice/application";
import type { ActorContext, WorkEdge, WorkItem } from "@arclattice/domain";
import {
  DomainError,
  defaultNavigationPreference,
  type NavigationPreference,
  normalizeNavigationPreference,
} from "@arclattice/domain";

interface MemoryState {
  navigation: Map<string, NavigationPreference>;
  calendarSettings: CalendarSettings;
  workflows: Map<string, WorkflowRecord>;
  workflowEvents: WorkflowRecord[];
  categories: Map<string, ProjectCategory>;
  categoryChanges: CategoryChange[];
  items: Map<string, WorkItem>;
  edges: Map<string, WorkEdge>;
  activity: ActivityEvent[];
  outbox: OutboxEvent[];
}
const emptyState = (): MemoryState => ({
  navigation: new Map(),
  calendarSettings: { version: 0, timezone: null },
  workflows: new Map(),
  workflowEvents: [],
  categories: new Map(),
  categoryChanges: [],
  items: new Map(),
  edges: new Map(),
  activity: [],
  outbox: [],
});

/** Volatile reference adapter, NOT a persistence or production security boundary. */
export class MemoryUnitOfWork implements UnitOfWork {
  private readonly workspaces = new Map<string, MemoryState>();
  private tail: Promise<void> = Promise.resolve();

  run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    const pending = this.tail.then(async () => {
      const state = structuredClone(
        this.workspaces.get(workspaceId) ?? emptyState(),
      );
      let open = true;
      const assertOpen = () => {
        if (!open) throw new Error("Transaction is closed");
      };
      const assertScope = (entity: { workspaceId: string }) => {
        assertOpen();
        if (entity.workspaceId !== workspaceId)
          throw new DomainError("FORBIDDEN");
      };
      const get = (id: string): WorkItem => {
        assertOpen();
        const item = state.items.get(id);
        if (!item) throw new DomainError("NOT_FOUND");
        return structuredClone(
          item.type === "TASK"
            ? {
                ...item,
                projectIds: item.projectIds ?? [],
              }
            : item,
        );
      };
      const tx: WorkTransaction = {
        navigationPreference: async (principalId) => {
          assertOpen();
          return structuredClone(
            normalizeNavigationPreference(
              state.navigation.get(principalId) ??
                defaultNavigationPreference(),
            ),
          );
        },
        saveNavigationPreference: async (principalId, preference, expected) => {
          assertOpen();
          if (
            (state.navigation.get(principalId)?.version ?? 0) !== expected ||
            preference.version !== expected + 1
          )
            throw new DomainError("VERSION_CONFLICT");
          state.navigation.set(principalId, structuredClone(preference));
        },
        calendarSettings: async () => {
          assertOpen();
          return { ...state.calendarSettings };
        },
        saveCalendarSettings: async (settings, expected) => {
          assertOpen();
          if (
            state.calendarSettings.version !== expected ||
            settings.version !== expected + 1
          )
            throw new DomainError("VERSION_CONFLICT");
          state.calendarSettings = { ...settings };
        },
        workflows: async () => {
          assertOpen();
          return structuredClone([...state.workflows.values()]);
        },
        saveWorkflow: async (record, expected) => {
          assertScope(record);
          const old = state.workflows.get(record.id);
          if (
            (old?.version ?? 0) !== expected ||
            record.version !== expected + 1
          )
            throw new DomainError("VERSION_CONFLICT");
          if (
            old &&
            (old.createdBy !== record.createdBy ||
              old.createdAt !== record.createdAt ||
              old.payload.kind !== record.payload.kind)
          )
            throw new DomainError("VALIDATION_ERROR");
          state.workflows.set(record.id, structuredClone(record));
          state.workflowEvents.push(structuredClone(record));
        },
        categories: async () => {
          assertOpen();
          return structuredClone([...state.categories.values()]);
        },
        saveCategory: async (category, expectedVersion) => {
          assertScope(category);
          if (
            (state.categories.get(category.id)?.version ?? 0) !==
              expectedVersion ||
            category.version !== expectedVersion + 1
          )
            throw new DomainError("VERSION_CONFLICT");
          state.categories.set(category.id, structuredClone(category));
        },
        appendCategoryChange: async (event) => {
          assertScope(event);
          state.categoryChanges.push(structuredClone(event));
        },
        get: async (id) => get(id),
        list: async (includeDeleted = false) => {
          assertOpen();
          return structuredClone(
            [...state.items.values()]
              .map((item) => get(item.id))
              .filter((item) => includeDeleted || !item.deletedAt),
          );
        },
        edges: async () => {
          assertOpen();
          return structuredClone([...state.edges.values()]);
        },
        insert: async (item) => {
          assertScope(item);
          if (state.items.has(item.id) || item.version !== 1)
            throw new DomainError("VERSION_CONFLICT");
          state.items.set(item.id, structuredClone(item));
        },
        replace: async (item, expectedVersion) => {
          assertScope(item);
          const old = get(item.id);
          if (
            old.version !== expectedVersion ||
            item.version !== expectedVersion + 1
          )
            throw new DomainError("VERSION_CONFLICT", {
              expectedVersion,
              actualVersion: old.version,
            });
          state.items.set(item.id, structuredClone(item));
        },
        addEdge: async (edge) => {
          assertScope(edge);
          if (state.edges.has(edge.id)) throw new DomainError("DUPLICATE_EDGE");
          if (get(edge.fromId).deletedAt || get(edge.toId).deletedAt)
            throw new DomainError("NOT_FOUND");
          state.edges.set(edge.id, structuredClone(edge));
        },
        removeEdge: async (id) => {
          assertOpen();
          if (!state.edges.delete(id)) throw new DomainError("NOT_FOUND");
        },
        appendActivity: async (event) => {
          assertScope(event);
          state.activity.push(structuredClone(event));
        },
        appendOutbox: async (event) => {
          assertScope(event);
          state.outbox.push(structuredClone(event));
        },
      };
      try {
        const result = await operation(tx);
        const detached = structuredClone(result);
        this.workspaces.set(workspaceId, state);
        return detached;
      } finally {
        open = false;
      }
    });
    // A failed transaction must not poison subsequent transactions.
    this.tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async inspectEvents(
    workspaceId: string,
  ): Promise<{ activity: ActivityEvent[]; outbox: OutboxEvent[] }> {
    await this.tail;
    const state = this.workspaces.get(workspaceId) ?? emptyState();
    return structuredClone({ activity: state.activity, outbox: state.outbox });
  }
}

export interface LocalGrant extends ActorContext {
  readonly permissions: readonly Permission[];
}
/** Explicit allow-list for local composition and tests; no registration or remote auth. */
export class LocalAuthorization implements AuthorizationService {
  private readonly grants: readonly LocalGrant[];
  constructor(grants: readonly LocalGrant[]) {
    this.grants = structuredClone(grants);
  }
  async require(context: ActorContext, permission: Permission): Promise<void> {
    if (
      !this.grants.some(
        (grant) =>
          grant.workspaceId === context.workspaceId &&
          grant.principalId === context.principalId &&
          grant.permissions.includes(permission),
      )
    ) {
      throw new DomainError("FORBIDDEN");
    }
  }
}
