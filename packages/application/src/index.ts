import {
  localCalendarDay,
  type ProjectLifecycle,
  projectLifecyclePatch,
  projectSubtreeHeight,
  requireCalendarTimezone,
  requireOpenProjectOwner,
  requireProjectCompletable,
  taskOwnership,
} from "@arclattice/domain";

export * from "./categories";
export * from "./project-materials";
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
  MAX_PROJECT_DEPTH,
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
  readonly calendarTimezone?: string;
  now(): string;
}
export interface IdGenerator {
  next(): string;
}
export interface ActivityEvent {
  readonly fromId?: string | null;
  readonly toId?: string | null;
  readonly edgeType?: EdgeType | null;
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
    | "WORK_EDGE_REMOVED"
    | "WORKSPACE_SETTINGS_UPDATED";
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
  readonly calendarSettings?: CalendarSettings;
  readonly calendarTimezone?: string;
  readonly items: readonly WorkItem[];
  readonly edges: readonly WorkEdge[];
}
/** A transaction is already bound to one workspace by UnitOfWork.run. */
export interface WorkTransaction {
  calendarSettings(): Promise<CalendarSettings>;
  saveCalendarSettings(
    settings: CalendarSettings,
    expectedVersion: number,
  ): Promise<void>;
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
export interface CalendarSettings {
  readonly version: number;
  readonly timezone: string | null;
}
export interface TaskOwnershipInput {
  readonly ownerProjectId?: string | null;
  readonly linkedProjectIds?: readonly string[];
}
export interface CreateWorkInput extends TaskOwnershipInput {
  readonly prerequisiteIds?: readonly string[];
  readonly reopenProjectVersion?: number;
  readonly assigneePrincipalId?: string | null;
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
export interface UpdateWorkInput extends TaskOwnershipInput {
  readonly projectLifecycle?: ProjectLifecycle;
  readonly assigneePrincipalId?: string | null;
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
  /** Canonical prerequisite task ids. Applied atomically with the task update. */
  readonly prerequisiteIds?: readonly string[];
  readonly expectedPrerequisiteIds?: readonly string[];
}
export class WorkService {
  private assignee(value: string | null): string | null {
    if (
      value !== null &&
      (typeof value !== "string" || !value.trim() || value.length > 240)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "assigneePrincipalId",
      });
    return value;
  }
  constructor(
    private readonly uow: UnitOfWork,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    if (clock.calendarTimezone !== undefined)
      requireCalendarTimezone(clock.calendarTimezone);
  }

  async snapshot(
    context: ActorContext,
    includeDeleted = false,
  ): Promise<WorkSnapshot> {
    await this.authorization.require(context, "work:read");
    return this.uow.run(context.workspaceId, async (tx) => ({
      calendarTimezone: await this.calendarTimezone(tx),
      calendarSettings: await tx.calendarSettings(),
      items: await tx.list(includeDeleted),
      edges: await tx.edges(),
    }));
  }

  async create(
    context: ActorContext,
    input: CreateWorkInput,
  ): Promise<WorkItem> {
    await this.authorization.require(context, "work:create");
    const prerequisiteIds = this.prerequisites(input.prerequisiteIds);
    if (prerequisiteIds?.length)
      await this.authorization.require(context, "graph:write");
    if (input.reopenProjectVersion !== undefined)
      await this.authorization.require(context, "work:update");
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
        assigneePrincipalId: this.assignee(input.assigneePrincipalId ?? null),
        projectId: input.projectId ?? null,
        ...(input.projectIds === undefined
          ? {}
          : {
              projectIds: input.projectIds,
              projectId: input.projectIds[0] ?? null,
            }),
        ...this.resolveOwnership(input, input.type ?? "TASK"),
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
      if (input.reopenProjectVersion !== undefined)
        await this.reopenOwner(
          tx,
          context,
          item.projectId,
          input.reopenProjectVersion,
          now,
        );
      await this.validateMemberships(tx, item, input);
      requireOpenProjectOwner(item, await tx.list());
      await this.validatePlanning(tx, item);
      if (prerequisiteIds !== undefined && item.type !== "TASK")
        throw new DomainError("VALIDATION_ERROR", { field: "prerequisiteIds" });
      const normalized = await this.normalizeActivation(tx, item);
      await tx.insert(normalized);
      for (const fromId of prerequisiteIds ?? []) {
        const prerequisite = await tx.get(fromId);
        if (prerequisite.type !== "TASK" || prerequisite.deletedAt)
          throw new DomainError("VALIDATION_ERROR", {
            field: "prerequisiteIds",
          });
        const edge: WorkEdge = {
          id: this.ids.next(),
          workspaceId: context.workspaceId,
          fromId,
          toId: item.id,
          type: "BLOCKS",
          createdBy: context.principalId,
          createdAt: now,
        };
        validateEdge(edge, await tx.list(), await tx.edges());
        await tx.addEdge(edge);
        await this.record(tx, context, edge.id, "WORK_EDGE_ADDED", now, edge);
      }
      await this.record(tx, context, item.id, "WORK_ITEM_CREATED", now);
      await this.reconcileDependents(tx, context, now);
      return tx.get(item.id);
    });
  }

  async update(
    context: ActorContext,
    id: string,
    expectedVersion: number,
    input: UpdateWorkInput,
  ): Promise<WorkItem> {
    await this.authorization.require(context, "work:update");
    this.prerequisites(input.prerequisiteIds);
    this.prerequisites(input.expectedPrerequisiteIds);
    if (input.projectIds !== undefined && !Array.isArray(input.projectIds))
      throw new DomainError("VALIDATION_ERROR", { field: "projectIds" });
    return this.uow.run(context.workspaceId, async (tx) => {
      const previous = await tx.get(id);
      if (previous.deletedAt) throw new DomainError("NOT_FOUND");
      if (previous.version !== expectedVersion)
        throw new DomainError("VERSION_CONFLICT");
      if (
        input.projectLifecycle !== undefined &&
        (previous.type !== "PROJECT" ||
          input.status !== undefined ||
          input.activationState !== undefined ||
          input.activationPolicy !== undefined)
      )
        throw new DomainError("VALIDATION_ERROR", {
          field: "projectLifecycle",
        });
      if (
        previous.type === "PROJECT" &&
        (input.activationState !== undefined ||
          input.activationPolicy !== undefined)
      )
        throw new DomainError("VALIDATION_ERROR", {
          field: "projectLifecycle",
        });
      if (input.status !== undefined)
        requireMember(input.status, workStatuses, "status");
      const lifecycle: Partial<WorkItem> =
        input.projectLifecycle !== undefined
          ? projectLifecyclePatch(input.projectLifecycle)
          : previous.type === "PROJECT" && input.status !== undefined
            ? projectLifecyclePatch(
                input.status === "DONE"
                  ? "COMPLETED"
                  : input.status === "CANCELED"
                    ? "CANCELED"
                    : input.status === "IN_PROGRESS"
                      ? "ACTIVE"
                      : "PLANNED",
              )
            : {};
      const status = requireMember(
        lifecycle.status ?? input.status ?? previous.status,
        workStatuses,
        "status",
      );
      // Reopening a prerequisite would invalidate an already started dependent.
      if (
        previous.type !== "PROJECT" &&
        previous.status === "DONE" &&
        status !== "DONE"
      ) {
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
      const existingEdges = await tx.edges();
      const existingPrerequisites = existingEdges
        .filter((edge) => dependency(edge)?.[1] === id)
        .map((edge) => dependency(edge)?.[0])
        .filter((value): value is string => value !== undefined)
        .sort();
      const requestedPrerequisites =
        input.prerequisiteIds === undefined
          ? existingPrerequisites
          : [...new Set(input.prerequisiteIds)].sort();
      if (
        input.expectedPrerequisiteIds !== undefined &&
        JSON.stringify(existingPrerequisites) !==
          JSON.stringify([...new Set(input.expectedPrerequisiteIds)].sort())
      )
        throw new DomainError("VERSION_CONFLICT");
      if (previous.type !== "TASK" && input.prerequisiteIds !== undefined)
        throw new DomainError("VALIDATION_ERROR", { field: "prerequisiteIds" });
      if (input.prerequisiteIds !== undefined) {
        if (
          JSON.stringify(existingPrerequisites) !==
          JSON.stringify(requestedPrerequisites)
        )
          await this.authorization.require(context, "graph:write");
        const items = await tx.list();
        for (const prerequisiteId of requestedPrerequisites) {
          const prerequisite = items.find(
            (entry) => entry.id === prerequisiteId,
          );
          if (
            !prerequisite ||
            prerequisite.type !== "TASK" ||
            prerequisite.deletedAt
          )
            throw new DomainError("VALIDATION_ERROR", {
              field: "prerequisiteIds",
            });
          if (prerequisiteId === id)
            throw new DomainError("WORK_GRAPH_CYCLE_DETECTED");
        }
      }
      const now = this.clock.now();
      const item: WorkItem = {
        ...previous,
        assigneePrincipalId:
          input.assigneePrincipalId === undefined
            ? previous.assigneePrincipalId
            : this.assignee(input.assigneePrincipalId),
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
        ...this.resolveOwnership(input, previous.type, previous),
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
        ...lifecycle,
        status,
        version: previous.version + 1,
        updatedBy: context.principalId,
        updatedAt: now,
        completedAt: status === "DONE" ? (previous.completedAt ?? now) : null,
      };
      if (
        item.type === "PROJECT" &&
        status === "DONE" &&
        previous.status !== "DONE"
      )
        requireProjectCompletable(item, await tx.list());
      requireOpenProjectOwner(item, await tx.list(), previous);
      await this.validateMemberships(tx, item, input, previous);
      await this.validatePlanning(tx, item);
      if (input.prerequisiteIds !== undefined) {
        const keep = new Set(requestedPrerequisites);
        for (const edge of existingEdges) {
          const pair = dependency(edge);
          if (pair?.[1] === id && !keep.has(pair[0])) {
            await tx.removeEdge(edge.id);
            await this.record(
              tx,
              context,
              edge.id,
              "WORK_EDGE_REMOVED",
              now,
              edge,
            );
          }
        }
        const current = await tx.edges();
        for (const prerequisiteId of requestedPrerequisites) {
          if (
            !current.some(
              (edge) =>
                dependency(edge)?.[0] === prerequisiteId &&
                dependency(edge)?.[1] === id,
            )
          ) {
            const edge: WorkEdge = {
              id: this.ids.next(),
              workspaceId: context.workspaceId,
              fromId: prerequisiteId,
              toId: id,
              type: "BLOCKS",
              createdBy: context.principalId,
              createdAt: now,
            };
            validateEdge(edge, await tx.list(), await tx.edges());
            await tx.addEdge(edge);
            await this.record(
              tx,
              context,
              edge.id,
              "WORK_EDGE_ADDED",
              now,
              edge,
            );
          }
        }
      }
      const normalized = await this.normalizeActivation(tx, item);
      if (
        item.type !== "PROJECT" &&
        (status === "IN_PROGRESS" || status === "DONE")
      ) {
        if (
          (status !== previous.status || input.prerequisiteIds !== undefined) &&
          blockers(item, await tx.list(), await tx.edges()).length
        )
          throw new DomainError("WORK_ITEM_BLOCKED");
        if (
          (status !== previous.status || previous.status === "IN_PROGRESS") &&
          !isExecutionActive(
            normalized,
            localCalendarDay(now, await this.calendarTimezone(tx)),
          )
        )
          throw new DomainError("WORK_ITEM_BLOCKED");
      }
      await tx.replace(normalized, expectedVersion);
      await this.record(tx, context, item.id, "WORK_ITEM_UPDATED", now);
      await this.reconcileDependents(tx, context, now);
      return tx.get(item.id);
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
        ((await tx.list()).some((item) => item.projectId === id) ||
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
        requireOpenProjectOwner(item, await tx.list(), previous);
        // Preserve historical references; never promote a reference to owner.
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
        const items = await tx.list();
        const endpoints = pair.map((id) =>
          items.find((item) => item.id === id),
        );
        if (endpoints.some((item) => item?.type !== "TASK")) {
          throw new DomainError("VALIDATION_ERROR", {
            field: "dependencyEndpoints",
          });
        }
        const dependent = await tx.get(pair[1]);
        if (
          (dependent.status === "DONE" || dependent.status === "IN_PROGRESS") &&
          (await tx.get(pair[0])).status !== "DONE"
        )
          throw new DomainError("WORK_ITEM_BLOCKED");
      }
      await tx.addEdge(edge);
      await this.record(tx, context, edge.id, "WORK_EDGE_ADDED", now, edge);
      await this.reconcileDependents(tx, context, now);
      return edge;
    });
  }

  private async reopenOwner(
    tx: WorkTransaction,
    context: ActorContext,
    projectId: string | null,
    expectedVersion: number,
    now: string,
  ): Promise<void> {
    if (!projectId || !Number.isInteger(expectedVersion) || expectedVersion < 1)
      throw new DomainError("VALIDATION_ERROR", {
        field: "reopenProjectVersion",
      });
    const previous = await tx.get(projectId);
    if (previous.version !== expectedVersion)
      throw new DomainError("VERSION_CONFLICT");
    if (
      previous.type !== "PROJECT" ||
      previous.deletedAt ||
      previous.status !== "DONE"
    )
      throw new DomainError("PROJECT_REOPEN_REQUIRED");
    const project = {
      ...previous,
      ...projectLifecyclePatch("ACTIVE"),
      completedAt: null,
      version: previous.version + 1,
      updatedAt: now,
      updatedBy: context.principalId,
    };
    requireOpenProjectOwner(project, await tx.list(), previous);
    await tx.replace(project, expectedVersion);
    await this.record(tx, context, projectId, "WORK_ITEM_UPDATED", now);
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
        let depth = projectSubtreeHeight(item, await tx.list());
        while (ancestor) {
          if (visited.has(ancestor.id))
            throw new DomainError("WORK_GRAPH_CYCLE_DETECTED");
          visited.add(ancestor.id);
          depth += 1;
          if (depth > MAX_PROJECT_DEPTH)
            throw new DomainError("VALIDATION_ERROR", {
              field: "projectDepth",
            });
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
      const edge = (await tx.edges()).find((entry) => entry.id === id);
      if (!edge) throw new DomainError("NOT_FOUND");
      await tx.removeEdge(id);
      await this.record(
        tx,
        context,
        id,
        "WORK_EDGE_REMOVED",
        this.clock.now(),
        edge,
      );
      await this.reconcileDependents(tx, context, this.clock.now());
    });
  }

  private resolveOwnership(
    input: CreateWorkInput | UpdateWorkInput,
    type: WorkType,
    previous?: WorkItem,
  ): Partial<WorkItem> {
    if (
      input.ownerProjectId === undefined &&
      input.linkedProjectIds === undefined
    )
      return {};
    if (
      type !== "TASK" ||
      input.projectId !== undefined ||
      input.projectIds !== undefined
    )
      throw new DomainError("VALIDATION_ERROR", { field: "ownership" });
    const owner =
      input.ownerProjectId === undefined
        ? (previous?.projectId ?? null)
        : input.ownerProjectId;
    const links =
      input.linkedProjectIds ??
      (previous ? taskOwnership(previous).linkedProjectIds : []);
    if (
      !Array.isArray(links) ||
      links.length > 100 ||
      links.some((id) => typeof id !== "string" || !id || id.length > 240) ||
      new Set(links).size !== links.length
    )
      throw new DomainError("VALIDATION_ERROR", { field: "linkedProjectIds" });
    if (
      owner !== null &&
      (typeof owner !== "string" || !owner || owner.length > 240)
    )
      throw new DomainError("VALIDATION_ERROR", { field: "ownerProjectId" });
    return {
      projectId: owner,
      projectIds: [
        ...(owner ? [owner] : []),
        ...links.filter((id) => id !== owner),
      ],
    };
  }

  private async validateMemberships(
    tx: WorkTransaction,
    item: WorkItem,
    input: CreateWorkInput | UpdateWorkInput,
    previous?: WorkItem,
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
      // Existing reference tombstones remain context, not structural owners.
      if (id !== item.projectId && previous?.projectIds?.includes(id)) continue;
      const project = await tx.get(id);
      if (
        project.type !== "PROJECT" ||
        project.deletedAt ||
        project.workspaceId !== item.workspaceId
      )
        throw new DomainError("VALIDATION_ERROR", { field: "projectIds" });
    }
  }

  async setCalendarSettings(
    context: ActorContext,
    expectedVersion: number,
    timezone: string | null,
  ): Promise<CalendarSettings> {
    await this.authorization.require(context, "work:update");
    const canonical =
      timezone === null ? null : requireCalendarTimezone(timezone);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
      throw new DomainError("VALIDATION_ERROR", { field: "version" });
    return this.uow.run(context.workspaceId, async (tx) => {
      const settings = { version: expectedVersion + 1, timezone: canonical };
      await tx.saveCalendarSettings(settings, expectedVersion);
      await this.record(
        tx,
        context,
        context.workspaceId,
        "WORKSPACE_SETTINGS_UPDATED",
        this.clock.now(),
      );
      return settings;
    });
  }

  private async calendarTimezone(tx: WorkTransaction): Promise<string> {
    return (
      (await tx.calendarSettings()).timezone ??
      this.clock.calendarTimezone ??
      "UTC"
    );
  }

  private prerequisites(
    value: readonly string[] | undefined,
  ): string[] | undefined {
    if (value === undefined) return undefined;
    if (
      !Array.isArray(value) ||
      value.length > 1000 ||
      value.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 240,
      ) ||
      new Set(value).size !== value.length
    )
      throw new DomainError("VALIDATION_ERROR", { field: "prerequisiteIds" });
    return [...value].sort();
  }

  private async normalizeActivation(
    tx: WorkTransaction,
    item: WorkItem,
  ): Promise<WorkItem> {
    if (item.type === "PROJECT") return item;
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
        previous.type === "PROJECT" ||
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
    edge?: WorkEdge,
  ): Promise<void> {
    const id = this.ids.next();
    await tx.appendActivity({
      id,
      workspaceId: context.workspaceId,
      principalId: context.principalId,
      entityId,
      type,
      occurredAt,
      fromId: edge?.fromId ?? null,
      toId: edge?.toId ?? null,
      edgeType: edge?.type ?? null,
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
export * from "./gateway-policy";
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
