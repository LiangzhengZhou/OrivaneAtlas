export * from "./categories";
export * from "./workflows";

import type { WorkflowRecord } from "./workflows";

export * from "./connected";
export * from "./notebook";
export * from "./organization";

import type {
  ActivationPolicy,
  ActivationState,
  ActorContext,
  EdgeType,
  Priority,
  WorkEdge,
  WorkItem,
  WorkStatus,
  WorkType,
} from "@arclattice/domain";
import {
  activationPolicies,
  activationStates,
  blockers,
  DomainError,
  dependency,
  edgeTypes,
  isExecutionActive,
  priorities,
  requireMember,
  requireTitle,
  validateEdge,
  validateSchedule,
  workStatuses,
  workTypes,
} from "@arclattice/domain";
import type { CategoryChange, ProjectCategory } from "./categories";

export type Permission =
  | "work:read"
  | "work:create"
  | "work:update"
  | "work:delete"
  | "graph:write";
export interface AuthorizationService {
  require(context: ActorContext, permission: Permission): Promise<void>;
}
export interface Clock {
  now(): string;
}
export interface IdGenerator {
  next(): string;
}
export interface ActivityEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly entityId: string;
  readonly type:
    | "WORK_ITEM_CREATED"
    | "WORK_ITEM_UPDATED"
    | "WORK_ITEM_DELETED"
    | "WORK_ITEM_RESTORED"
    | "WORK_EDGE_ADDED"
    | "WORK_EDGE_REMOVED";
  readonly occurredAt: string;
}
export interface OutboxEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly activityId: string;
  readonly type: "WORK_CHANGED";
  readonly occurredAt: string;
}
export interface WorkSnapshot {
  readonly items: readonly WorkItem[];
  readonly edges: readonly WorkEdge[];
}
/** A transaction is already bound to one workspace by UnitOfWork.run. */
export interface WorkTransaction {
  workflows(): Promise<WorkflowRecord[]>;
  saveWorkflow(record: WorkflowRecord, expectedVersion: number): Promise<void>;
  categories(): Promise<ProjectCategory[]>;
  saveCategory(
    category: ProjectCategory,
    expectedVersion: number,
  ): Promise<void>;
  appendCategoryChange(event: CategoryChange): Promise<void>;
  list(includeDeleted?: boolean): Promise<readonly WorkItem[]>;
  get(id: string): Promise<WorkItem>;
  edges(): Promise<readonly WorkEdge[]>;
  insert(item: WorkItem): Promise<void>;
  replace(item: WorkItem, expectedVersion: number): Promise<void>;
  addEdge(edge: WorkEdge): Promise<void>;
  removeEdge(id: string): Promise<void>;
  appendActivity(event: ActivityEvent): Promise<void>;
  appendOutbox(event: OutboxEvent): Promise<void>;
}
export interface UnitOfWork {
  run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T>;
}
export interface CreateWorkInput {
  readonly projectIds?: readonly string[];
  readonly projectId?: string | null;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly title: string;
  readonly type?: WorkType;
  readonly priority?: Priority;
  readonly descriptionMd?: string;
  readonly activationState?: ActivationState;
  readonly activationPolicy?: ActivationPolicy;
}
export interface UpdateWorkInput {
  readonly projectIds?: readonly string[];
  readonly projectId?: string | null;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly title?: string;
  readonly status?: WorkStatus;
  readonly priority?: Priority;
  readonly descriptionMd?: string;
  readonly activationState?: ActivationState;
  readonly activationPolicy?: ActivationPolicy;
}
export class WorkService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async snapshot(
    context: ActorContext,
    includeDeleted = false,
  ): Promise<WorkSnapshot> {
    await this.authorization.require(context, "work:read");
    return this.uow.run(context.workspaceId, async (tx) => ({
      items: await tx.list(includeDeleted),
      edges: await tx.edges(),
    }));
  }

  async create(
    context: ActorContext,
    input: CreateWorkInput,
  ): Promise<WorkItem> {
    await this.authorization.require(context, "work:create");
    if (input.projectIds !== undefined && !Array.isArray(input.projectIds))
      throw new DomainError("VALIDATION_ERROR", { field: "projectIds" });
    return this.uow.run(context.workspaceId, async (tx) => {
      const now = this.clock.now();
      const item: WorkItem = {
        id: this.ids.next(),
        workspaceId: context.workspaceId,
        title: requireTitle(input.title),
        descriptionMd: input.descriptionMd ?? "",
        type: requireMember(input.type ?? "TASK", workTypes, "type"),
        priority: requireMember(
          input.priority ?? "MEDIUM",
          priorities,
          "priority",
        ),
        status: "TODO",
        executionMode: "MANUAL",
        assigneePrincipalId: null,
        projectId: input.projectId ?? null,
        ...(input.projectIds === undefined
          ? {}
          : {
              projectIds: input.projectIds,
              projectId: input.projectIds[0] ?? null,
            }),
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        activationState: requireMember(
          input.activationState === undefined
            ? "ACTIVE"
            : input.activationState,
          activationStates,
          "activationState",
        ),
        activationPolicy: requireMember(
          input.activationPolicy === undefined
            ? "MANUAL"
            : input.activationPolicy,
          activationPolicies,
          "activationPolicy",
        ),
        version: 1,
        createdBy: context.principalId,
        updatedBy: context.principalId,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        deletedAt: null,
      };
      await this.validateMemberships(tx, item, input);
      await this.validatePlanning(tx, item);
      const normalized = await this.normalizeActivation(tx, item);
      await tx.insert(normalized);
      await this.record(tx, context, item.id, "WORK_ITEM_CREATED", now);
      return normalized;
    });
  }

  async update(
    context: ActorContext,
    id: string,
    expectedVersion: number,
    input: UpdateWorkInput,
  ): Promise<WorkItem> {
    await this.authorization.require(context, "work:update");
    if (input.projectIds !== undefined && !Array.isArray(input.projectIds))
      throw new DomainError("VALIDATION_ERROR", { field: "projectIds" });
    return this.uow.run(context.workspaceId, async (tx) => {
      const previous = await tx.get(id);
      if (previous.deletedAt) throw new DomainError("NOT_FOUND");
      const status = requireMember(
        input.status ?? previous.status,
        workStatuses,
        "status",
      );
      if (
        status !== previous.status &&
        (status === "IN_PROGRESS" || status === "DONE") &&
        blockers(previous, await tx.list(), await tx.edges()).length
      ) {
        throw new DomainError("WORK_ITEM_BLOCKED");
      }
      // Reopening a prerequisite would invalidate an already started dependent.
      if (previous.status === "DONE" && status !== "DONE") {
        const active = await tx.list();
        const hasStartedDependent = (await tx.edges()).some((edge) => {
          const pair = dependency(edge);
          const target =
            pair?.[0] === id
              ? active.find((item) => item.id === pair[1])
              : undefined;
          return target?.status === "IN_PROGRESS" || target?.status === "DONE";
        });
        if (hasStartedDependent) throw new DomainError("DEPENDENCY_EXISTS");
      }
      const now = this.clock.now();
      const item: WorkItem = {
        ...previous,
        ...(input.projectIds !== undefined
          ? { projectIds: input.projectIds }
          : input.projectId !== undefined && previous.type === "TASK"
            ? { projectIds: input.projectId ? [input.projectId] : [] }
            : {}),
        projectId:
          input.projectIds !== undefined
            ? (input.projectIds[0] ?? null)
            : input.projectId === undefined
              ? previous.projectId
              : input.projectId,
        startDate:
          input.startDate === undefined ? previous.startDate : input.startDate,
        dueDate: input.dueDate === undefined ? previous.dueDate : input.dueDate,
        activationState: requireMember(
          input.activationState === undefined
            ? previous.activationState
            : input.activationState,
          activationStates,
          "activationState",
        ),
        activationPolicy: requireMember(
          input.activationPolicy === undefined
            ? previous.activationPolicy
            : input.activationPolicy,
          activationPolicies,
          "activationPolicy",
        ),
        title:
          input.title === undefined
            ? previous.title
            : requireTitle(input.title),
        descriptionMd: input.descriptionMd ?? previous.descriptionMd,
        priority: requireMember(
          input.priority ?? previous.priority,
          priorities,
          "priority",
        ),
        status,
        version: previous.version + 1,
        updatedBy: context.principalId,
        updatedAt: now,
        completedAt: status === "DONE" ? (previous.completedAt ?? now) : null,
      };
      await this.validateMemberships(tx, item, input);
      await this.validatePlanning(tx, item);
      const normalized = await this.normalizeActivation(tx, item);
      if (
        (status === "IN_PROGRESS" || status === "DONE") &&
        !isExecutionActive(normalized, now.slice(0, 10)) &&
        (status !== previous.status || previous.status === "IN_PROGRESS")
      )
        throw new DomainError("WORK_ITEM_BLOCKED");
      await tx.replace(normalized, expectedVersion);
      await this.record(tx, context, item.id, "WORK_ITEM_UPDATED", now);
      await this.reconcileDependents(tx, context, now);
      return normalized;
    });
  }

  async setDeleted(
    context: ActorContext,
    id: string,
    expectedVersion: number,
    deleted: boolean,
  ): Promise<WorkItem> {
    await this.authorization.require(
      context,
      deleted ? "work:delete" : "work:update",
    );
    return this.uow.run(context.workspaceId, async (tx) => {
      const previous = await tx.get(id);
      if (
        deleted &&
        ((await tx.list()).some(
          (item) => item.projectId === id || item.projectIds?.includes(id),
        ) ||
          (await tx.edges()).some(
            (edge) => edge.fromId === id || edge.toId === id,
          ))
      )
        throw new DomainError("DEPENDENCY_EXISTS");
      const now = this.clock.now();
      const item = {
        ...previous,
        // A deleted project may no longer be a valid destination on restore.
        projectId:
          !deleted &&
          previous.projectId &&
          !(await tx.list()).some(
            (p) => p.id === previous.projectId && p.type === "PROJECT",
          )
            ? null
            : previous.projectId,
        deletedAt: deleted ? now : null,
        updatedAt: now,
        updatedBy: context.principalId,
        version: previous.version + 1,
      };
      if (!deleted) {
        if (item.type === "TASK") {
          const liveProjects = new Set(
            (await tx.list())
              .filter((p) => p.type === "PROJECT")
              .map((p) => p.id),
          );
          item.projectIds = (
            previous.projectIds ??
            (previous.projectId ? [previous.projectId] : [])
          ).filter((id) => liveProjects.has(id));
          item.projectId = item.projectIds[0] ?? null;
        }
        await this.validatePlanning(tx, item);
      }
      await tx.replace(item, expectedVersion);
      await this.record(
        tx,
        context,
        id,
        deleted ? "WORK_ITEM_DELETED" : "WORK_ITEM_RESTORED",
        now,
      );
      return item;
    });
  }

  async addEdge(
    context: ActorContext,
    fromId: string,
    toId: string,
    type: EdgeType = "BLOCKS",
  ): Promise<WorkEdge> {
    await this.authorization.require(context, "graph:write");
    return this.uow.run(context.workspaceId, async (tx) => {
      const now = this.clock.now();
      const edge: WorkEdge = {
        id: this.ids.next(),
        workspaceId: context.workspaceId,
        fromId,
        toId,
        type: requireMember(type, edgeTypes, "edgeType"),
        createdBy: context.principalId,
        createdAt: now,
      };
      validateEdge(edge, await tx.list(), await tx.edges());
      const pair = dependency(edge);
      if (pair) {
        const dependent = await tx.get(pair[1]);
        if (
          (dependent.status === "DONE" || dependent.status === "IN_PROGRESS") &&
          (await tx.get(pair[0])).status !== "DONE"
        )
          throw new DomainError("WORK_ITEM_BLOCKED");
      }
      await tx.addEdge(edge);
      await this.record(tx, context, edge.id, "WORK_EDGE_ADDED", now);
      await this.reconcileDependents(tx, context, now);
      return edge;
    });
  }

  private async validatePlanning(
    tx: WorkTransaction,
    item: WorkItem,
  ): Promise<void> {
    validateSchedule(item.startDate, item.dueDate);
    if (item.projectId !== null) {
      if (typeof item.projectId !== "string" || item.projectId === item.id)
        throw new DomainError("VALIDATION_ERROR", { field: "projectId" });
      const project = await tx.get(item.projectId);
      if (
        project.deletedAt ||
        project.type !== "PROJECT" ||
        project.workspaceId !== item.workspaceId
      )
        throw new DomainError("NOT_FOUND");
      if (item.type === "PROJECT") {
        const visited = new Set([item.id]);
        let ancestor: WorkItem | null = project;
        while (ancestor) {
          if (visited.has(ancestor.id))
            throw new DomainError("WORK_GRAPH_CYCLE_DETECTED");
          visited.add(ancestor.id);
          ancestor = ancestor.projectId
            ? await tx.get(ancestor.projectId)
            : null;
        }
      }
    }
  }

  async removeEdge(context: ActorContext, id: string): Promise<void> {
    await this.authorization.require(context, "graph:write");
    return this.uow.run(context.workspaceId, async (tx) => {
      await tx.removeEdge(id);
      await this.record(tx, context, id, "WORK_EDGE_REMOVED", this.clock.now());
      await this.reconcileDependents(tx, context, this.clock.now());
    });
  }

  private async validateMemberships(
    tx: WorkTransaction,
    item: WorkItem,
    input: CreateWorkInput | UpdateWorkInput,
  ) {
    const ids = item.projectIds;
    if (ids === undefined) return;
    if (
      item.type !== "TASK" ||
      !Array.isArray(ids) ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string" || !id || id.length > 240) ||
      new Set(ids).size !== ids.length ||
      (input.projectIds !== undefined &&
        input.projectId !== undefined &&
        input.projectId !== (ids[0] ?? null))
    )
      throw new DomainError("VALIDATION_ERROR", { field: "projectIds" });
    for (const id of ids) {
      const project = await tx.get(id);
      if (
        project.type !== "PROJECT" ||
        project.deletedAt ||
        project.workspaceId !== item.workspaceId
      )
        throw new DomainError("VALIDATION_ERROR", { field: "projectIds" });
    }
  }

  private async normalizeActivation(
    tx: WorkTransaction,
    item: WorkItem,
  ): Promise<WorkItem> {
    let activationState = item.activationState;
    if (item.activationPolicy === "AT_SCHEDULED_TIME") {
      if (!item.startDate)
        throw new DomainError("VALIDATION_ERROR", { field: "startDate" });
      activationState = "SCHEDULED";
    } else if (item.activationPolicy === "IMMEDIATE")
      activationState = "ACTIVE";
    else if (item.activationPolicy === "WHEN_DEPENDENCIES_COMPLETED")
      activationState = blockers(item, await tx.list(), await tx.edges()).length
        ? "INACTIVE"
        : "ACTIVE";
    else if (activationState === "SCHEDULED")
      throw new DomainError("VALIDATION_ERROR", { field: "activationState" });
    return {
      ...item,
      activationState,
      ...(item.type === "TASK"
        ? {
            projectIds:
              item.projectIds ?? (item.projectId ? [item.projectId] : []),
          }
        : {}),
    };
  }

  private async reconcileDependents(
    tx: WorkTransaction,
    context: ActorContext,
    now: string,
  ) {
    const items = await tx.list();
    const edges = await tx.edges();
    for (const previous of items) {
      if (
        previous.activationPolicy !== "WHEN_DEPENDENCIES_COMPLETED" ||
        previous.status !== "TODO"
      )
        continue;
      const activationState = blockers(previous, items, edges).length
        ? "INACTIVE"
        : "ACTIVE";
      if (activationState === previous.activationState) continue;
      await tx.replace(
        {
          ...previous,
          activationState,
          version: previous.version + 1,
          updatedBy: context.principalId,
          updatedAt: now,
        },
        previous.version,
      );
      await this.record(tx, context, previous.id, "WORK_ITEM_UPDATED", now);
    }
  }

  private async record(
    tx: WorkTransaction,
    context: ActorContext,
    entityId: string,
    type: ActivityEvent["type"],
    occurredAt: string,
  ): Promise<void> {
    const id = this.ids.next();
    await tx.appendActivity({
      id,
      workspaceId: context.workspaceId,
      principalId: context.principalId,
      entityId,
      type,
      occurredAt,
    });
    await tx.appendOutbox({
      id: this.ids.next(),
      workspaceId: context.workspaceId,
      activityId: id,
      type: "WORK_CHANGED",
      occurredAt,
    });
  }
}
export * from "./accounts";
export * from "./content-policy";
export * from "./library";
export {
  executeApprovedModel,
  validateApprovedContext,
  validateContextPolicy,
} from "./model-gateway";
export type {
  PersonalModelInput,
  PersonalModelSummary,
  PersonalModelVault,
} from "./personal-ai";
export { type AiTextEdit, parseAiTextEdits } from "./personal-ai";
export type { AppUpdateInfo, AppUpdateProgress, AppUpdates } from "./updates";
