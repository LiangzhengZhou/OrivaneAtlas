import {
  type ActorContext,
  DomainError,
  localCalendarDay,
  occurrenceDays,
  requireTitle,
  validateCalendarRule,
  validateSchedule,
} from "@arclattice/domain";
import {
  type AuthorizationService,
  type Clock,
  type IdGenerator,
  type UnitOfWork,
  WorkService,
  type WorkTransaction,
} from "./index";

export interface ManifestTask {
  tempId: string;
  title: string;
  descriptionMd: string;
  startDate: string | null;
  dueDate: string | null;
  dependsOn: string[];
}
export interface PlanPayload {
  kind: "PLAN";
  projectId: string;
  tasks: ManifestTask[];
  baseRevision: string;
  policy: "manifest-v1";
  published: boolean;
  result: Record<string, string>;
  provenance: {
    taskId: string;
    fields: string[];
    source: "IMPORTED";
    confirmedBy: string;
    confirmedAt: string;
  }[];
}
export interface RecurrencePayload {
  kind: "RECURRENCE";
  title: string;
  descriptionMd: string;
  projectId: string | null;
  startDate: string;
  timezone: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  schedulerThrough?: string;
}
export interface OccurrencePayload {
  kind: "OCCURRENCE";
  definitionId: string;
  definitionVersion: number;
  day: string;
  status: "MISSED" | "CREATED" | "BACKFILLED";
  taskId: string | null;
  completedAt: string | null;
  recordedAt: string;
  backfilledAt: string | null;
  ruleSnapshot?: RecurrencePayload;
}
export interface WorkflowRecord {
  id: string;
  workspaceId: string;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  payload: PlanPayload | RecurrencePayload | OccurrencePayload;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError("VALIDATION_ERROR");
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new DomainError("VALIDATION_ERROR");
}
export function parseManifest(value: unknown): ManifestTask[] {
  const manifest = object(value);
  fields(manifest, ["version", "tasks"]);
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.tasks) ||
    !manifest.tasks.length ||
    manifest.tasks.length > 100
  )
    throw new DomainError("VALIDATION_ERROR");
  const tasks = manifest.tasks.map((value) => {
    const task = object(value);
    fields(task, [
      "tempId",
      "title",
      "descriptionMd",
      "startDate",
      "dueDate",
      "dependsOn",
    ]);
    if (
      typeof task.tempId !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(task.tempId) ||
      typeof task.title !== "string" ||
      (task.descriptionMd !== undefined &&
        (typeof task.descriptionMd !== "string" ||
          task.descriptionMd.length > 200000))
    )
      throw new DomainError("VALIDATION_ERROR");
    const startDate = task.startDate ?? null,
      dueDate = task.dueDate ?? null;
    if (
      (startDate !== null && typeof startDate !== "string") ||
      (dueDate !== null && typeof dueDate !== "string")
    )
      throw new DomainError("VALIDATION_ERROR");
    validateSchedule(startDate, dueDate);
    const dependsOn = task.dependsOn ?? [];
    if (
      !Array.isArray(dependsOn) ||
      dependsOn.length > 100 ||
      dependsOn.some((id) => typeof id !== "string") ||
      new Set(dependsOn).size !== dependsOn.length
    )
      throw new DomainError("VALIDATION_ERROR");
    return {
      tempId: task.tempId,
      title: requireTitle(task.title),
      descriptionMd: (task.descriptionMd ?? "") as string,
      startDate,
      dueDate,
      dependsOn: dependsOn as string[],
    };
  });
  const byId = new Map(tasks.map((t) => [t.tempId, t]));
  if (byId.size !== tasks.length) throw new DomainError("VALIDATION_ERROR");
  const visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw new DomainError("NOT_FOUND");
    if (visiting.has(id)) throw new DomainError("WORK_GRAPH_CYCLE_DETECTED");
    visiting.add(id);
    for (const parent of task.dependsOn) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.tempId);
  return tasks;
}
async function revision(tx: WorkTransaction) {
  return JSON.stringify({
    items: (await tx.list(true))
      .map((i) => [i.id, i.version])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    edges: (await tx.edges())
      .map((e) => [e.id, e.fromId, e.toId, e.type])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}
export class WorkflowService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly auth: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  private work(tx: WorkTransaction, context: ActorContext) {
    return new WorkService(
      {
        run: async (workspace, operation) => {
          if (workspace !== context.workspaceId)
            throw new DomainError("FORBIDDEN");
          return operation(tx);
        },
      },
      this.auth,
      this.clock,
      this.ids,
    );
  }
  private async save(
    tx: WorkTransaction,
    context: ActorContext,
    payload: WorkflowRecord["payload"],
    old?: WorkflowRecord,
    id?: string,
    deleted = false,
  ) {
    const now = this.clock.now();
    const record: WorkflowRecord = {
      id: old?.id ?? id ?? this.ids.next(),
      workspaceId: context.workspaceId,
      version: (old?.version ?? 0) + 1,
      createdBy: old?.createdBy ?? context.principalId,
      updatedBy: context.principalId,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      deletedAt: deleted ? now : null,
      payload,
    };
    await tx.saveWorkflow(record, old?.version ?? 0);
    return record;
  }
  async list(context: ActorContext) {
    await this.auth.require(context, "work:read");
    return this.uow.run(context.workspaceId, (tx) => tx.workflows());
  }
  async preview(context: ActorContext, projectId: string, manifest: unknown) {
    await this.auth.require(context, "work:create");
    const tasks = parseManifest(manifest);
    return this.uow.run(context.workspaceId, async (tx) => {
      const project = await tx.get(projectId);
      if (project.type !== "PROJECT" || project.deletedAt)
        throw new DomainError("NOT_FOUND");
      return this.save(tx, context, {
        kind: "PLAN",
        projectId,
        tasks,
        baseRevision: await revision(tx),
        policy: "manifest-v1",
        published: false,
        result: {},
        provenance: [],
      });
    });
  }
  async publish(context: ActorContext, id: string, version: number) {
    if (!Number.isInteger(version) || version < 1)
      throw new DomainError("VALIDATION_ERROR");
    await this.auth.require(context, "work:create");
    await this.auth.require(context, "graph:write");
    return this.uow.run(context.workspaceId, async (tx) => {
      const plan = (await tx.workflows()).find(
        (r) => r.id === id && !r.deletedAt,
      );
      if (!plan || plan.payload.kind !== "PLAN")
        throw new DomainError("NOT_FOUND");
      if (plan.createdBy !== context.principalId)
        throw new DomainError("FORBIDDEN");
      if (plan.payload.published && plan.version === version + 1) return plan;
      if (
        plan.version !== version ||
        plan.payload.published ||
        plan.payload.policy !== "manifest-v1" ||
        plan.payload.baseRevision !== (await revision(tx))
      )
        throw new DomainError("VERSION_CONFLICT");
      const tasks = parseManifest({ version: 1, tasks: plan.payload.tasks });
      const work = this.work(tx, context),
        result: Record<string, string> = Object.create(null);
      for (const task of tasks) {
        const item = await work.create(context, {
          title: task.title,
          descriptionMd: task.descriptionMd,
          startDate: task.startDate,
          dueDate: task.dueDate,
          projectId: plan.payload.projectId,
        });
        result[task.tempId] = item.id;
      }
      for (const task of tasks)
        for (const parent of task.dependsOn)
          await work.addEdge(context, result[parent]!, result[task.tempId]!);
      return this.save(
        tx,
        context,
        {
          ...plan.payload,
          published: true,
          result,
          provenance: Object.values(result).map((taskId) => ({
            taskId,
            fields: [
              "title",
              "descriptionMd",
              "startDate",
              "dueDate",
              "projectId",
            ],
            source: "IMPORTED",
            confirmedBy: context.principalId,
            confirmedAt: this.clock.now(),
          })),
        },
        plan,
      );
    });
  }
  async saveRecurrence(
    context: ActorContext,
    input: {
      id?: string;
      version: number;
      deleted: boolean;
      rule: Omit<RecurrencePayload, "kind">;
    },
  ) {
    await this.auth.require(
      context,
      input.version === 0
        ? "work:create"
        : input.deleted
          ? "work:delete"
          : "work:update",
    );
    if (
      !Number.isInteger(input.version) ||
      input.version < 0 ||
      typeof input.deleted !== "boolean" ||
      (input.version === 0 && input.deleted)
    )
      throw new DomainError("VALIDATION_ERROR");
    validateCalendarRule(input.rule);
    if (
      typeof input.rule.descriptionMd !== "string" ||
      input.rule.descriptionMd.length > 200000
    )
      throw new DomainError("VALIDATION_ERROR");
    const rule: RecurrencePayload = {
      ...input.rule,
      kind: "RECURRENCE",
      title: requireTitle(input.rule.title),
    };
    return this.uow.run(context.workspaceId, async (tx) => {
      const old = input.id
        ? (await tx.workflows()).find((r) => r.id === input.id)
        : undefined;
      if (input.id && !old) throw new DomainError("NOT_FOUND");
      if (
        (old?.version ?? 0) !== input.version ||
        (old && old.payload.kind !== "RECURRENCE")
      )
        throw new DomainError("VERSION_CONFLICT");
      if (rule.projectId !== null) {
        const project = await tx.get(rule.projectId);
        if (project.deletedAt || project.type !== "PROJECT")
          throw new DomainError("VALIDATION_ERROR");
      }
      // Caller input must never control background progress.
      delete rule.schedulerThrough;
      if (old) {
        const today = localCalendarDay(this.clock.now(), rule.timezone);
        rule.schedulerThrough = calendarOffset(today, -1);
      }
      return this.save(tx, context, rule, old, undefined, input.deleted);
    });
  }
  /** Bounded, atomic and restart-safe. The host reauthorizes the creator. */
  async tick(context: ActorContext, id: string) {
    await this.auth.require(context, "work:create");
    return this.uow.run(context.workspaceId, async (tx) => {
      const definition = (await tx.workflows()).find((r) => r.id === id);
      if (
        !definition ||
        definition.deletedAt ||
        definition.payload.kind !== "RECURRENCE"
      )
        return [];
      if (definition.createdBy !== context.principalId)
        throw new DomainError("FORBIDDEN");
      const rule = definition.payload;
      const today = localCalendarDay(this.clock.now(), rule.timezone);
      const from = rule.schedulerThrough
        ? calendarOffset(rule.schedulerThrough, 1)
        : rule.startDate;
      if (from > today) return [];
      const to = [calendarOffset(from, 365), today].sort()[0]!;
      const scoped = new WorkflowService(
        {
          run: async (workspace, operation) => {
            if (workspace !== context.workspaceId)
              throw new DomainError("FORBIDDEN");
            return operation(tx);
          },
        },
        this.auth,
        this.clock,
        this.ids,
      );
      const result = await scoped.generate(
        context,
        id,
        definition.version,
        from,
        to,
      );
      await this.save(
        tx,
        context,
        { ...rule, schedulerThrough: to },
        definition,
      );
      return result;
    });
  }
  async generate(
    context: ActorContext,
    id: string,
    version: number,
    from: string,
    to: string,
  ) {
    await this.auth.require(context, "work:create");
    return this.uow.run(context.workspaceId, async (tx) => {
      const records = await tx.workflows(),
        definition = records.find((r) => r.id === id && !r.deletedAt);
      if (!definition || definition.payload.kind !== "RECURRENCE")
        throw new DomainError("NOT_FOUND");
      if (definition.version !== version)
        throw new DomainError("VERSION_CONFLICT");
      const rule = definition.payload,
        today = localCalendarDay(this.clock.now(), rule.timezone);
      if (to > today) throw new DomainError("VALIDATION_ERROR");
      const result: WorkflowRecord[] = [];
      for (const day of occurrenceDays(rule, from, to)) {
        const occurrenceId = `occurrence:${id}:${day}`,
          existing = records.find((r) => r.id === occurrenceId);
        if (existing) {
          result.push(existing);
          continue;
        }
        const task =
          day === today
            ? await this.work(tx, context).create(context, {
                title: rule.title,
                descriptionMd: rule.descriptionMd,
                projectId: rule.projectId,
                startDate: day,
                dueDate: day,
              })
            : null;
        result.push(
          await this.save(
            tx,
            context,
            {
              kind: "OCCURRENCE",
              definitionId: id,
              definitionVersion: version,
              day,
              status: task ? "CREATED" : "MISSED",
              taskId: task?.id ?? null,
              completedAt: null,
              recordedAt: this.clock.now(),
              backfilledAt: null,
              ruleSnapshot: { ...rule },
            },
            undefined,
            occurrenceId,
          ),
        );
      }
      return result;
    });
  }
  async backfill(
    context: ActorContext,
    id: string,
    version: number,
    completedAt: string | null,
  ) {
    await this.auth.require(context, "work:create");
    if (
      completedAt !== null &&
      (!Number.isFinite(Date.parse(completedAt)) ||
        Date.parse(completedAt) > Date.parse(this.clock.now()))
    )
      throw new DomainError("VALIDATION_ERROR");
    return this.uow.run(context.workspaceId, async (tx) => {
      const records = await tx.workflows(),
        old = records.find((r) => r.id === id && !r.deletedAt);
      if (!old || old.payload.kind !== "OCCURRENCE")
        throw new DomainError("NOT_FOUND");
      if (old.version !== version || old.payload.status !== "MISSED")
        throw new DomainError("VERSION_CONFLICT");
      const occurrence = old.payload;
      const definition = records.find(
        (r) => r.id === occurrence.definitionId && !r.deletedAt,
      );
      if (!definition || definition.payload.kind !== "RECURRENCE")
        throw new DomainError("NOT_FOUND");
      if (
        !old.payload.ruleSnapshot &&
        definition.version !== old.payload.definitionVersion
      )
        throw new DomainError("VERSION_CONFLICT");
      const rule = old.payload.ruleSnapshot ?? definition.payload,
        work = this.work(tx, context);
      if (
        completedAt &&
        localCalendarDay(completedAt, rule.timezone) < old.payload.day
      )
        throw new DomainError("VALIDATION_ERROR");
      const task = await work.create(context, {
        title: rule.title,
        descriptionMd: rule.descriptionMd,
        projectId: rule.projectId,
        startDate: old.payload.day,
        dueDate: old.payload.day,
      });
      if (completedAt)
        await work.update(context, task.id, task.version, { status: "DONE" });
      return this.save(
        tx,
        context,
        {
          ...old.payload,
          status: "BACKFILLED",
          taskId: task.id,
          completedAt,
          backfilledAt: this.clock.now(),
        },
        old,
      );
    });
  }
}

function calendarOffset(day: string, days: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
