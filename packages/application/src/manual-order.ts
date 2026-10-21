import {
  type ActorContext,
  DomainError,
  type ManualOrderEntry,
  type ManualOrderState,
  manualOrderScopeKey,
  planOrderMove,
  planOrderSequence,
  projectScope,
  requireManualOrderScope,
  type WorkItem,
} from "@arclattice/domain";
import type {
  AuthorizationService,
  Clock,
  IdGenerator,
  UnitOfWork,
} from "./index";

type Scope = ManualOrderState["scope"];

/** Membership and authoritative positions are resolved inside the same transaction. */
export class ManualOrderService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async list(context: ActorContext): Promise<readonly ManualOrderState[]> {
    await this.authorization.require(context, "work:read");
    return this.uow.run(context.workspaceId, (tx) => tx.manualOrders());
  }

  async placeSequence(
    contextInput: ActorContext,
    inputValue: {
      readonly scope: Scope;
      readonly version: number;
      readonly orderedEntityIds: readonly string[];
    },
  ): Promise<ManualOrderState> {
    const context = structuredClone(contextInput),
      input = structuredClone(inputValue);
    await this.authorization.require(context, "work:update");
    const scope = requireManualOrderScope(input.scope);
    if (
      !Number.isSafeInteger(input.version) ||
      input.version < 0 ||
      !Array.isArray(input.orderedEntityIds) ||
      !input.orderedEntityIds.length ||
      input.orderedEntityIds.length > 10000 ||
      input.orderedEntityIds.some((id) => typeof id !== "string" || !id) ||
      new Set(input.orderedEntityIds).size !== input.orderedEntityIds.length
    )
      throw new DomainError("VALIDATION_ERROR");
    return this.changeOrder(context, scope, input.version, (initial) =>
      planOrderSequence(initial, input.orderedEntityIds),
    );
  }

  async move(
    context: ActorContext,
    input: {
      readonly scope: Scope;
      readonly version: number;
      readonly entityId: string;
      readonly anchorId: string | null;
      readonly placement: "BEFORE" | "AFTER";
    },
  ): Promise<ManualOrderState> {
    await this.authorization.require(context, "work:update");
    if (
      !Number.isSafeInteger(input.version) ||
      input.version < 0 ||
      (input.placement !== "BEFORE" && input.placement !== "AFTER")
    )
      throw new DomainError("VALIDATION_ERROR");
    const scope = requireManualOrderScope(input.scope);
    return this.changeOrder(context, scope, input.version, (initial) => {
      const members = new Set(initial.map((entry) => entry.entityId));
      if (
        !members.has(input.entityId) ||
        (input.anchorId !== null && !members.has(input.anchorId))
      )
        throw new DomainError("VALIDATION_ERROR", {
          reason: "ORDER_SCOPE_MEMBERSHIP",
        });
      return planOrderMove(
        initial,
        input.entityId,
        input.anchorId,
        input.placement,
      );
    });
  }
  private changeOrder(
    context: ActorContext,
    scope: Scope,
    version: number,
    plan: (
      initial: readonly ManualOrderEntry[],
    ) => readonly { entityId: string; position: number }[],
  ): Promise<ManualOrderState> {
    const scopeKey = manualOrderScopeKey(scope);
    return this.uow.run(context.workspaceId, async (tx) => {
      const previous = (await tx.manualOrders()).find(
        (state) => state.id === scopeKey,
      );
      if ((previous?.version ?? 0) !== version)
        throw new DomainError("VERSION_CONFLICT");
      const items = await tx.list();
      const members = orderMembers(items, scope);
      const membersById = new Map(members.map((item) => [item.id, item]));
      const now = this.clock.now();
      const retained = (previous?.entries ?? [])
        .filter((entry) => membersById.has(entry.entityId))
        .sort((a, b) => a.position - b.position);
      const existing = new Map(
        retained.map((entry) => [entry.entityId, entry]),
      );
      const missing = members
        .filter((item) => !existing.has(item.id))
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
      const initial: ManualOrderEntry[] = [...retained];
      let lastPosition = initial.at(-1)?.position ?? 0;
      for (const item of missing) {
        if (!Number.isSafeInteger(lastPosition + 1024)) {
          for (const [index, entry] of initial.entries())
            initial[index] = { ...entry, position: (index + 1) * 1024 };
          lastPosition = initial.length * 1024;
        }
        lastPosition += 1024;
        initial.push({
          workspaceId: context.workspaceId,
          scopeKey,
          entityId: item.id,
          position: lastPosition,
          version: 0,
          updatedAt: now,
          updatedBy: context.principalId,
        });
      }
      const planned = new Map(
        plan(initial).map((entry) => [entry.entityId, entry.position]),
      );
      const entries = initial
        .map((entry) => {
          const position = planned.get(entry.entityId) ?? entry.position;
          const old = existing.get(entry.entityId);
          return old && old.position === position
            ? old
            : {
                ...entry,
                position,
                version: (old?.version ?? 0) + 1,
                updatedAt: now,
                updatedBy: context.principalId,
              };
        })
        .sort((a, b) => a.position - b.position);
      if (
        previous &&
        entries.length === previous.entries.length &&
        entries.every((entry) => existing.get(entry.entityId) === entry)
      )
        return previous;
      const state: ManualOrderState = {
        id: scopeKey,
        workspaceId: context.workspaceId,
        scope,
        entries,
        version: version + 1,
        updatedAt: now,
        updatedBy: context.principalId,
      };
      await tx.saveManualOrder(state, version);
      const activityId = this.ids.next();
      await tx.appendActivity({
        id: activityId,
        workspaceId: context.workspaceId,
        principalId: context.principalId,
        entityId: scopeKey,
        type: "WORKSPACE_SETTINGS_UPDATED",
        occurredAt: now,
      });
      await tx.appendOutbox({
        id: this.ids.next(),
        workspaceId: context.workspaceId,
        activityId,
        type: "WORK_CHANGED",
        occurredAt: now,
      });
      return state;
    });
  }
}

function orderMembers(
  items: readonly WorkItem[],
  scope: Scope,
): readonly WorkItem[] {
  if (scope.kind === "WORKSPACE_TASKS")
    return items.filter((item) => item.type === "TASK" && !item.deletedAt);
  const projectId =
    scope.kind === "PROJECT_TASKS" ? scope.projectId : scope.parentProjectId;
  if (
    projectId !== null &&
    !items.some(
      (item) =>
        item.id === projectId && item.type === "PROJECT" && !item.deletedAt,
    )
  )
    throw new DomainError("NOT_FOUND");
  if (scope.kind === "PROJECT_TASKS") {
    const project = items.find(
      (item) =>
        item.id === scope.projectId &&
        item.type === "PROJECT" &&
        !item.deletedAt,
    );
    if (!project) throw new DomainError("NOT_FOUND");
    return projectScope(project, items, "SUBTREE").tasks;
  }
  return items.filter(
    (item) =>
      !item.deletedAt &&
      item.type === "PROJECT" &&
      item.parentProjectId === scope.parentProjectId,
  );
}
