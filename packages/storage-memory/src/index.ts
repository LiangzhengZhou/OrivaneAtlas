import type {
  ActivityEvent,
  AuthorizationService,
  CalendarSettings,
  CategoryChange,
  Organization,
  OutboxEvent,
  Permission,
  ProjectCategory,
  UnitOfWork,
  WorkflowRecord,
  WorkspaceChange,
  WorkTransaction,
} from "@arclattice/application";
import { normalizeWorkflowRecords } from "@arclattice/application";
import type {
  ActorContext,
  Reminder,
  WorkEdge,
  WorkItem,
} from "@arclattice/domain";
import {
  DomainError,
  defaultNavigationPreference,
  type NavigationPreference,
  normalizeNavigationPreference,
} from "@arclattice/domain";

interface MemoryState {
  changes: WorkspaceChange[];
  epoch: string;
  reminders: Map<string, Reminder>;
  reminderEvents: Reminder[];
  organizations: Map<string, Organization>;
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
  changes: [],
  epoch: crypto.randomUUID(),
  reminders: new Map(),
  reminderEvents: [],
  organizations: new Map(),
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
      const publish = (
        collection: string,
        entityId: string,
        version: number,
        op: "UPSERT" | "DELETE" = "UPSERT",
      ) =>
        state.changes.push({
          seq: state.changes.length + 1,
          workspaceId,
          collection,
          entityId,
          version,
          op,
        });
      const tx: WorkTransaction = {
        workspaceRelatedLinks: async () => {
          assertOpen();
          return [];
        },
        workspaceChanges: async (after, epoch) => {
          assertOpen();
          if (!Number.isSafeInteger(after) || after < 0)
            throw new DomainError("VALIDATION_ERROR");
          const recovery =
            after > state.changes.length || (!!epoch && epoch !== state.epoch);
          const changes = recovery
            ? []
            : structuredClone(state.changes.slice(after, after + 500));
          return {
            epoch: state.epoch,
            changes,
            cursor: changes.at(-1)?.seq ?? state.changes.length,
            recovery,
            hasMore: !recovery && after + changes.length < state.changes.length,
          };
        },
        workspaceEntity: async (collection, id) => {
          assertOpen();
          const value =
            collection === "items"
              ? state.items.get(id)
              : collection === "edges"
                ? state.edges.get(id)
                : collection === "categories"
                  ? state.categories.get(id)
                  : collection === "workflows"
                    ? state.workflows.get(id)
                    : collection === "organization"
                      ? state.organizations.get(id)
                      : collection === "reminders"
                        ? state.reminders.get(id)
                        : collection === "navigationPreference"
                          ? state.navigation.get(id)
                          : collection === "calendarSettings"
                            ? state.calendarSettings
                            : null;
          return structuredClone(value ?? null);
        },
        reminders: async () => {
          assertOpen();
          return structuredClone([...state.reminders.values()]);
        },
        saveReminder: async (value, expected) => {
          assertScope(value);
          if (
            (state.reminders.get(value.id)?.version ?? 0) !== expected ||
            value.version !== expected + 1
          )
            throw new DomainError("VERSION_CONFLICT");
          state.reminders.set(value.id, structuredClone(value));
          publish("reminders", value.id, value.version);
          state.reminderEvents.push(structuredClone(value));
        },
        organizations: async () => {
          assertOpen();
          return structuredClone([...state.organizations.values()]);
        },
        saveOrganization: async (value, expected) => {
          assertScope(value);
          const key = value.kind + ":" + value.id;
          if (
            (state.organizations.get(key)?.version ?? 0) !== expected ||
            value.version !== expected + 1
          )
            throw new DomainError("VERSION_CONFLICT");
          state.organizations.set(key, structuredClone(value));
          publish("organization", key, value.version);
        },
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
          publish("navigationPreference", principalId, preference.version);
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
          publish("calendarSettings", "workspace", settings.version);
        },
        workflows: async () => {
          assertOpen();
          return normalizeWorkflowRecords(
            structuredClone([...state.workflows.values()]),
          );
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
          publish("workflows", record.id, record.version);
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
          publish("categories", category.id, category.version);
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
          publish("items", item.id, item.version);
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
          publish("items", item.id, item.version);
        },
        purge: async (id, expected) => {
          const old = get(id);
          if (old.version !== expected)
            throw new DomainError("VERSION_CONFLICT");
          if (!old.deletedAt) throw new DomainError("VALIDATION_ERROR");
          for (const edge of state.edges.values())
            if (edge.fromId === id || edge.toId === id) {
              state.edges.delete(edge.id);
              publish("edges", edge.id, 1, "DELETE");
            }
          state.items.delete(id);
          publish("items", id, old.version, "DELETE");
        },
        addEdge: async (edge) => {
          assertScope(edge);
          if (state.edges.has(edge.id)) throw new DomainError("DUPLICATE_EDGE");
          if (get(edge.fromId).deletedAt || get(edge.toId).deletedAt)
            throw new DomainError("NOT_FOUND");
          state.edges.set(edge.id, structuredClone(edge));
          publish("edges", edge.id, 1);
        },
        removeEdge: async (id) => {
          assertOpen();
          if (!state.edges.delete(id)) throw new DomainError("NOT_FOUND");
          publish("edges", id, 1, "DELETE");
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
