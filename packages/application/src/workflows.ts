import {
  type ActivationPolicy,
  type ActivationState,
  type ActorContext,
  activationPolicies,
  activationStates,
  DomainError,
  localCalendarDay,
  MAX_PROJECT_DEPTH,
  occurrenceDays,
  type Priority,
  type ProjectLifecycle,
  priorities,
  projectLifecycles,
  requireMember,
  requireTitle,
  validateCalendarRule,
  validateSchedule,
} from "@arclattice/domain";
import { CategoryService } from "./categories";
import {
  type AuthorizationService,
  type Clock,
  type IdGenerator,
  type UnitOfWork,
  WorkService,
  type WorkTransaction,
} from "./index";

export interface TaskDefaults {
  projectIds?: string[];
  activationState?: ActivationState;
  activationPolicy?: ActivationPolicy;
  priority?: Priority;
  assigneePrincipalId?: string | null;
}

export interface ManifestTask extends TaskDefaults {
  type?: "TASK" | "MILESTONE";
  tempId: string;
  title: string;
  descriptionMd: string;
  startDate: string | null;
  dueDate: string | null;
  dependsOn: string[];
  projectTempId?: string;
  projectTempIds?: string[];
}
export interface ManifestProject {
  lifecycle?: ProjectLifecycle;
  categoryId?: string | null;
  tempId: string;
  title: string;
  descriptionMd: string;
  parentTempId: string | null;
}
export interface ManifestCategory {
  tempId: string;
  name: string;
  existingId?: string;
  projectIds: string[];
  projectTempIds: string[];
}
export interface ManifestRecurrence
  extends Omit<RecurrencePayload, "kind" | "schedulerThrough"> {
  tempId: string;
  projectTempIds: string[];
}
export interface ManifestKnowledgeSpace {
  tempId: string;
  title: string;
  descriptionMd: string;
}
export interface ManifestDocument {
  tempId: string;
  title: string;
  bodyMd: string;
  spaceTempId?: string;
  spaceId?: string;
  projectTempId?: string;
  projectId?: string;
  ownership: "OWNED" | "LINKED";
}
export interface ParsedPlan {
  projects: ManifestProject[];
  tasks: ManifestTask[];
  categories: ManifestCategory[];
  recurrences: ManifestRecurrence[];
  spaces: ManifestKnowledgeSpace[];
  documents: ManifestDocument[];
}
export interface PlanDocumentPublisher {
  publish(
    context: ActorContext,
    input: {
      projectId: string;
      title: string;
      bodyMd: string;
      ownership?: "OWNED" | "LINKED";
      provenance?: {
        planId: string;
        tempId: string;
        origin?: "HUMAN" | "EXTERNAL_AI";
      };
    },
  ): Promise<{ id: string }>;
  revision?(context: ActorContext, plan: ParsedPlan): Promise<string>;
  createSpace?(
    context: ActorContext,
    input: {
      title: string;
      descriptionMd: string;
      origin?: "HUMAN" | "EXTERNAL_AI";
    },
  ): Promise<{ id: string }>;
  publishKnowledgeDocument?(
    context: ActorContext,
    input: {
      spaceId: string;
      projectId: string | null;
      title: string;
      bodyMd: string;
      ownership: "OWNED" | "LINKED";
      provenance: {
        planId: string;
        tempId: string;
        origin?: "HUMAN" | "EXTERNAL_AI";
      };
    },
  ): Promise<{ id: string }>;
}
export interface PlanPayload {
  kind: "PLAN";
  origin?: "HUMAN" | "EXTERNAL_AI";
  projectId: string | null;
  projects: ManifestProject[];
  tasks: ManifestTask[];
  categories?: ManifestCategory[];
  recurrences?: ManifestRecurrence[];
  spaces?: ManifestKnowledgeSpace[];
  documents?: ManifestDocument[];
  documentRevision?: string;
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
export interface RecurrencePayload extends TaskDefaults {
  kind: "RECURRENCE";
  title: string;
  descriptionMd: string;
  startDate: string;
  endDate?: string | null;
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
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value))
    throw new DomainError("VALIDATION_ERROR");
  return value;
}
function references(value: unknown, temporary = false): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    new Set(value).size !== value.length
  )
    throw new DomainError("VALIDATION_ERROR");
  return value.map((id) => {
    if (temporary) return identifier(id);
    if (typeof id !== "string" || !id.trim() || id.length > 240)
      throw new DomainError("VALIDATION_ERROR");
    return id;
  });
}
function markdown(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 200000)
    throw new DomainError("VALIDATION_ERROR");
  return value;
}
const defaultFields = [
  "projectIds",
  "activationState",
  "activationPolicy",
  "priority",
  "assigneePrincipalId",
];
function taskDefaults(value: Record<string, unknown>): TaskDefaults {
  const result: TaskDefaults = {};
  if (value.projectIds !== undefined)
    result.projectIds = references(value.projectIds);
  if (value.activationState !== undefined)
    result.activationState = requireMember(
      value.activationState as ActivationState,
      activationStates,
      "activationState",
    );
  if (value.activationPolicy !== undefined)
    result.activationPolicy = requireMember(
      value.activationPolicy as ActivationPolicy,
      activationPolicies,
      "activationPolicy",
    );
  if (value.priority !== undefined)
    result.priority = requireMember(
      value.priority as Priority,
      priorities,
      "priority",
    );
  if (value.assigneePrincipalId !== undefined) {
    if (value.assigneePrincipalId !== null)
      references([value.assigneePrincipalId]);
    result.assigneePrincipalId = value.assigneePrincipalId as string | null;
  }
  return result;
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
      "type",
      "tempId",
      "title",
      "descriptionMd",
      "startDate",
      "dueDate",
      "dependsOn",
      "projectTempId",
      "projectTempIds",
      ...defaultFields,
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
    if (
      task.projectTempId !== undefined &&
      (typeof task.projectTempId !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(task.projectTempId))
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
    const dependsOn = task.dependsOn === undefined ? [] : task.dependsOn;
    if (
      !Array.isArray(dependsOn) ||
      dependsOn.length > 100 ||
      dependsOn.some((id) => typeof id !== "string") ||
      new Set(dependsOn).size !== dependsOn.length
    )
      throw new DomainError("VALIDATION_ERROR");
    return {
      ...taskDefaults(task),
      type: requireMember(
        (task.type ?? "TASK") as "TASK" | "MILESTONE",
        ["TASK", "MILESTONE"] as const,
        "type",
      ),
      tempId: task.tempId,
      title: requireTitle(task.title),
      descriptionMd: (task.descriptionMd ?? "") as string,
      startDate,
      dueDate,
      dependsOn: dependsOn as string[],
      ...(task.projectTempId === undefined
        ? {}
        : { projectTempId: task.projectTempId as string }),
      ...(task.projectTempIds === undefined
        ? {}
        : { projectTempIds: references(task.projectTempIds, true) }),
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
export function parseProjectPlan(value: unknown): ParsedPlan {
  const manifest = object(value);
  fields(manifest, [
    "version",
    "tasks",
    "milestones",
    "projects",
    "categories",
    "recurrences",
    "spaces",
    "documents",
  ]);
  if (manifest.version !== 1) throw new DomainError("VALIDATION_ERROR");
  if (
    (manifest.tasks !== undefined && !Array.isArray(manifest.tasks)) ||
    (manifest.milestones !== undefined && !Array.isArray(manifest.milestones))
  )
    throw new DomainError("VALIDATION_ERROR");
  const rawTasks = [
    ...((manifest.tasks ?? []) as unknown[]),
    ...((manifest.milestones ?? []) as unknown[]).map((entry) => ({
      ...object(entry),
      type: "MILESTONE",
    })),
  ];
  const tasks =
    Array.isArray(rawTasks) && rawTasks.length === 0
      ? []
      : parseManifest({ version: manifest.version, tasks: rawTasks });
  const rawProjects = manifest.projects === undefined ? [] : manifest.projects;
  if (!Array.isArray(rawProjects) || rawProjects.length > 64)
    throw new DomainError("VALIDATION_ERROR");
  const projects = rawProjects.map((value) => {
    const project = object(value);
    fields(project, [
      "tempId",
      "title",
      "descriptionMd",
      "parentTempId",
      "lifecycle",
      "categoryId",
    ]);
    if (
      typeof project.tempId !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(project.tempId)
    )
      throw new DomainError("VALIDATION_ERROR");
    return {
      tempId: project.tempId,
      lifecycle: requireMember(
        (project.lifecycle ?? "PLANNED") as ProjectLifecycle,
        projectLifecycles,
        "lifecycle",
      ),
      categoryId:
        project.categoryId == null
          ? null
          : references([project.categoryId])[0]!,
      title: requireTitle(
        typeof project.title === "string" ? project.title : "",
      ),
      descriptionMd: markdown(project.descriptionMd),
      parentTempId:
        project.parentTempId === undefined || project.parentTempId === null
          ? null
          : identifier(project.parentTempId),
    };
  });
  const ids = new Set(projects.map((p) => p.tempId));
  if (ids.size !== projects.length) throw new DomainError("VALIDATION_ERROR");
  const visiting = new Set<string>(),
    depths = new Map<string, number>();
  const sorted: ManifestProject[] = [];
  const depth = (id: string): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) throw new DomainError("WORK_GRAPH_CYCLE_DETECTED");
    visiting.add(id);
    const parent = projects.find((p) => p.tempId === id)?.parentTempId;
    if (parent !== null && (!parent || !ids.has(parent)))
      throw new DomainError("NOT_FOUND");
    const value = parent === null ? 1 : depth(parent) + 1;
    visiting.delete(id);
    depths.set(id, value);
    if (value > MAX_PROJECT_DEPTH)
      throw new DomainError("VALIDATION_ERROR", { field: "projectDepth" });
    sorted.push(projects.find((project) => project.tempId === id)!);
    return value;
  };
  projects.forEach((p) => depth(p.tempId));
  const array = (key: string): Record<string, unknown>[] => {
    const entries = manifest[key] === undefined ? [] : manifest[key];
    if (!Array.isArray(entries) || entries.length > 100)
      throw new DomainError("VALIDATION_ERROR");
    return entries.map(object);
  };
  const categories = array("categories").map((entry): ManifestCategory => {
    fields(entry, [
      "tempId",
      "name",
      "existingId",
      "projectIds",
      "projectTempIds",
    ]);
    const existingId =
      entry.existingId === undefined
        ? undefined
        : references([entry.existingId])[0];
    return {
      tempId: identifier(entry.tempId),
      name: requireTitle(typeof entry.name === "string" ? entry.name : ""),
      ...(existingId ? { existingId } : {}),
      projectIds: references(entry.projectIds),
      projectTempIds: references(entry.projectTempIds, true),
    };
  });
  const recurrences = array("recurrences").map((entry): ManifestRecurrence => {
    fields(entry, [
      "tempId",
      "title",
      "descriptionMd",
      "projectTempIds",
      "startDate",
      "endDate",
      "timezone",
      "frequency",
      "interval",
      ...defaultFields,
    ]);
    const rule = {
      ...taskDefaults(entry),
      tempId: identifier(entry.tempId),
      title: requireTitle(typeof entry.title === "string" ? entry.title : ""),
      descriptionMd: markdown(entry.descriptionMd),
      projectTempIds: references(entry.projectTempIds, true),
      startDate: entry.startDate as string,
      endDate: (entry.endDate ?? null) as string | null,
      timezone: entry.timezone as string,
      frequency: entry.frequency as RecurrencePayload["frequency"],
      interval: entry.interval as number,
    };
    validateCalendarRule(rule);
    return rule;
  });
  const spaces = array("spaces").map((entry): ManifestKnowledgeSpace => {
    fields(entry, ["tempId", "title", "descriptionMd"]);
    return {
      tempId: identifier(entry.tempId),
      title: requireTitle(typeof entry.title === "string" ? entry.title : ""),
      descriptionMd: markdown(entry.descriptionMd),
    };
  });
  const documents = array("documents").map((entry): ManifestDocument => {
    fields(entry, [
      "tempId",
      "title",
      "bodyMd",
      "spaceTempId",
      "spaceId",
      "projectTempId",
      "projectId",
      "ownership",
    ]);
    if (
      (entry.spaceTempId !== undefined && entry.spaceId !== undefined) ||
      (entry.projectTempId !== undefined && entry.projectId !== undefined)
    )
      throw new DomainError("VALIDATION_ERROR");
    const document: ManifestDocument = {
      tempId: identifier(entry.tempId),
      title: requireTitle(typeof entry.title === "string" ? entry.title : ""),
      bodyMd: markdown(entry.bodyMd),
      ownership: requireMember(
        (entry.ownership ?? "LINKED") as "OWNED" | "LINKED",
        ["OWNED", "LINKED"] as const,
        "ownership",
      ),
    };
    for (const key of ["spaceTempId", "projectTempId"] as const)
      if (entry[key] !== undefined) document[key] = identifier(entry[key]);
    for (const key of ["spaceId", "projectId"] as const)
      if (entry[key] !== undefined)
        document[key] = references([entry[key]])[0]!;
    if (
      !document.spaceId &&
      !document.spaceTempId &&
      !document.projectId &&
      !document.projectTempId
    )
      throw new DomainError("VALIDATION_ERROR");
    if (
      document.ownership === "OWNED" &&
      !document.projectId &&
      !document.projectTempId
    )
      throw new DomainError("VALIDATION_ERROR");
    return document;
  });
  const entries = [
    ...projects,
    ...tasks,
    ...categories,
    ...recurrences,
    ...spaces,
    ...documents,
  ];
  if (
    !entries.length ||
    new Set(entries.map((entry) => entry.tempId)).size !== entries.length
  )
    throw new DomainError("VALIDATION_ERROR");
  const checkProjects = (references: string[]) => {
    for (const ref of references)
      if (!ids.has(ref)) throw new DomainError("NOT_FOUND");
  };
  if (
    new Set(
      categories.map((category) => category.name.toLocaleLowerCase("en-US")),
    ).size !== categories.length ||
    new Set(
      categories
        .filter((category) => category.existingId)
        .map((category) => category.existingId),
    ).size !== categories.filter((category) => category.existingId).length
  )
    throw new DomainError("VALIDATION_ERROR");
  for (const task of tasks) {
    if (
      (task.activationPolicy === "AT_SCHEDULED_TIME" && !task.startDate) ||
      (task.activationState === "SCHEDULED" &&
        task.activationPolicy !== "AT_SCHEDULED_TIME")
    )
      throw new DomainError("VALIDATION_ERROR");
    if (task.projectTempId && task.projectTempIds !== undefined)
      throw new DomainError("VALIDATION_ERROR");
    checkProjects(
      task.projectTempIds ?? (task.projectTempId ? [task.projectTempId] : []),
    );
  }
  for (const entity of [...categories, ...recurrences])
    checkProjects(entity.projectTempIds);
  for (const document of documents) {
    if (document.projectTempId) checkProjects([document.projectTempId]);
    if (
      document.spaceTempId &&
      !spaces.some((space) => space.tempId === document.spaceTempId)
    )
      throw new DomainError("NOT_FOUND");
  }
  return {
    projects: sorted,
    tasks,
    categories,
    recurrences,
    spaces,
    documents,
  };
}
async function revision(tx: WorkTransaction) {
  return JSON.stringify({
    categories: (await tx.categories())
      .map((category) => [category.id, category.version])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
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
    private readonly documents?: PlanDocumentPublisher,
  ) {}
  private scoped(tx: WorkTransaction, context: ActorContext): UnitOfWork {
    return {
      run: async (workspace, operation) => {
        if (workspace !== context.workspaceId)
          throw new DomainError("FORBIDDEN");
        return operation(tx);
      },
    };
  }
  private async validatePlan(
    tx: WorkTransaction,
    context: ActorContext,
    plan: ParsedPlan,
    parentId: string | null,
  ) {
    const projectIds = new Set<string>();
    if (parentId) projectIds.add(parentId);
    for (const entry of [
      ...plan.tasks,
      ...plan.categories,
      ...plan.recurrences,
    ])
      for (const id of entry.projectIds ?? []) projectIds.add(id);
    for (const document of plan.documents)
      if (document.projectId) projectIds.add(document.projectId);
    for (const id of projectIds) {
      const project = await tx.get(id);
      if (project.type !== "PROJECT" || project.deletedAt)
        throw new DomainError("NOT_FOUND");
    }
    let parentDepth = 0,
      cursor = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) throw new DomainError("WORK_GRAPH_CYCLE_DETECTED");
      seen.add(cursor);
      parentDepth++;
      cursor = (await tx.get(cursor)).parentProjectId;
    }
    const depths = new Map<string, number>();
    for (const project of plan.projects) {
      const depth =
        (project.parentTempId
          ? depths.get(project.parentTempId)!
          : parentDepth) + 1;
      if (depth > MAX_PROJECT_DEPTH)
        throw new DomainError("VALIDATION_ERROR", { field: "projectDepth" });
      depths.set(project.tempId, depth);
    }
    const categories = await tx.categories();
    for (const category of plan.categories) {
      if (category.existingId) {
        const existing = categories.find(
          (entry) => entry.id === category.existingId && !entry.deletedAt,
        );
        if (!existing) throw new DomainError("NOT_FOUND");
        if (existing.name !== category.name)
          throw new DomainError("VERSION_CONFLICT");
      } else if (
        categories.some(
          (entry) =>
            !entry.deletedAt &&
            entry.name.toLocaleLowerCase("en-US") ===
              category.name.toLocaleLowerCase("en-US"),
        )
      )
        throw new DomainError("VALIDATION_ERROR");
    }
    if (plan.spaces.length || plan.documents.length) {
      if (!this.documents)
        throw new DomainError("VALIDATION_ERROR", { field: "documents" });
      if (plan.spaces.length && !this.documents.createSpace)
        throw new DomainError("VALIDATION_ERROR", { field: "spaces" });
      if (
        plan.documents.some(
          (document) => document.spaceId || document.spaceTempId,
        ) &&
        !this.documents.publishKnowledgeDocument
      )
        throw new DomainError("VALIDATION_ERROR", { field: "spaces" });
      return this.documents.revision
        ? this.documents.revision(context, plan)
        : "";
    }
    return "";
  }
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
  async preview(
    context: ActorContext,
    projectId: string | null,
    manifest: unknown,
    origin: "HUMAN" | "EXTERNAL_AI" = "HUMAN",
  ) {
    await this.auth.require(context, "work:create");
    const parsed = parseProjectPlan(manifest);
    return this.uow.run(context.workspaceId, async (tx) => {
      const documentRevision = await this.validatePlan(
        tx,
        context,
        parsed,
        projectId,
      );
      return this.save(tx, context, {
        kind: "PLAN",
        origin,
        projectId,
        ...parsed,
        documentRevision,
        baseRevision: await revision(tx),
        policy: "manifest-v1",
        published: false,
        result: {},
        provenance: [],
      });
    });
  }
  async publish(
    context: ActorContext,
    id: string,
    version: number,
    humanReview = false,
  ) {
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
      if (plan.createdBy !== context.principalId && !humanReview)
        throw new DomainError("FORBIDDEN");
      if (plan.payload.published && plan.version === version + 1) return plan;
      if (
        plan.version !== version ||
        plan.payload.published ||
        plan.payload.policy !== "manifest-v1" ||
        plan.payload.baseRevision !== (await revision(tx))
      )
        throw new DomainError("VERSION_CONFLICT");
      const parsed = parseProjectPlan({
        version: 1,
        projects: plan.payload.projects ?? [],
        tasks: plan.payload.tasks,
        categories: plan.payload.categories ?? [],
        recurrences: plan.payload.recurrences ?? [],
        spaces: plan.payload.spaces ?? [],
        documents: plan.payload.documents ?? [],
      });
      if (
        (await this.validatePlan(
          tx,
          context,
          parsed,
          plan.payload.projectId,
        )) !== (plan.payload.documentRevision ?? "")
      )
        throw new DomainError("VERSION_CONFLICT");
      const tasks = parsed.tasks;
      const work = this.work(tx, context),
        result: Record<string, string> = Object.create(null);
      const projectResult: Record<string, string> = Object.create(null);
      for (const project of parsed.projects) {
        const created = await work.create(context, {
          title: project.title,
          descriptionMd: project.descriptionMd,
          type: "PROJECT",
          lifecycle: project.lifecycle ?? "PLANNED",
          categoryId: project.categoryId ?? null,
          parentProjectId:
            (project.parentTempId
              ? projectResult[project.parentTempId]
              : plan.payload.projectId) ?? null,
        });
        projectResult[project.tempId] = created.id;
      }
      const memberships = (
        existing: string[] | undefined,
        temporary: string[],
        fallback: string | null,
      ): string[] => {
        const explicit = existing !== undefined || temporary.length > 0;
        return [
          ...new Set([
            ...(existing ?? []),
            ...temporary.map((id) => projectResult[id]!),
            ...(!explicit && fallback ? [fallback] : []),
          ]),
        ];
      };
      const categoryService = new CategoryService(
        this.scoped(tx, context),
        this.auth,
        this.clock,
        this.ids,
      );
      for (const category of parsed.categories) {
        const old = category.existingId
          ? (await tx.categories()).find(
              (entry) => entry.id === category.existingId,
            )!
          : undefined;
        const created = await categoryService.save(context, {
          ...(old ? { id: old.id } : {}),
          version: old?.version ?? 0,
          name: category.name,
          deleted: false,
        });
        for (const projectId of memberships(
          category.projectIds,
          category.projectTempIds,
          null,
        )) {
          const project = await tx.get(projectId);
          await work.update(context, project.id, project.version, {
            categoryId: created.id,
          });
        }
        result[category.tempId] = created.id;
      }
      for (const task of tasks) {
        const memberIds = memberships(
          task.projectIds,
          task.projectTempIds ??
            (task.projectTempId ? [task.projectTempId] : []),
          plan.payload.projectId,
        );
        if (task.type === "MILESTONE" && memberIds.length !== 1)
          throw new DomainError("VALIDATION_ERROR", {
            field: "milestoneProject",
          });
        const defaults = taskDefaults(
          task as unknown as Record<string, unknown>,
        );
        delete defaults.projectIds;
        const item = await work.create(context, {
          ...defaults,
          type: task.type ?? "TASK",
          title: task.title,
          descriptionMd: task.descriptionMd,
          startDate: task.startDate,
          dueDate: task.dueDate,
          ...(task.type === "MILESTONE"
            ? { parentProjectId: memberIds[0]! }
            : { projectIds: memberIds }),
        });
        result[task.tempId] = item.id;
      }
      for (const task of tasks)
        for (const parent of task.dependsOn)
          await work.addEdge(context, result[parent]!, result[task.tempId]!);
      const scoped = new WorkflowService(
        this.scoped(tx, context),
        this.auth,
        this.clock,
        this.ids,
        this.documents,
      );
      for (const recurrence of parsed.recurrences) {
        const { tempId, projectTempIds, ...rule } = recurrence;
        const created = await scoped.saveRecurrence(context, {
          version: 0,
          deleted: false,
          rule: {
            ...rule,
            projectIds: memberships(
              rule.projectIds,
              projectTempIds,
              plan.payload.projectId,
            ),
          },
        });
        result[tempId] = created.id;
      }
      if (parsed.spaces.length || parsed.documents.length) {
        for (const space of parsed.spaces) {
          result[space.tempId] = (
            await this.documents!.createSpace!(context, {
              ...space,
              origin: plan.payload.origin ?? "HUMAN",
            })
          ).id;
        }
        for (const document of parsed.documents) {
          const projectId = document.projectTempId
            ? projectResult[document.projectTempId]!
            : (document.projectId ?? null);
          const spaceId = document.spaceTempId
            ? result[document.spaceTempId]!
            : document.spaceId;
          const input = {
            projectId,
            title: document.title,
            bodyMd: document.bodyMd,
            ownership: document.ownership,
            provenance: {
              planId: plan.id,
              tempId: document.tempId,
              origin: plan.payload.origin ?? "HUMAN",
            },
          };
          const created = spaceId
            ? await this.documents!.publishKnowledgeDocument!(context, {
                ...input,
                spaceId,
              })
            : await this.documents!.publish(context, {
                ...input,
                projectId: projectId!,
              });
          if (!created.id) throw new DomainError("VALIDATION_ERROR");
          result[document.tempId] = created.id;
        }
      }
      return this.save(
        tx,
        context,
        {
          ...plan.payload,
          published: true,
          result: { ...projectResult, ...result },
          provenance: [
            ...parsed.projects,
            ...parsed.tasks,
            ...parsed.categories,
            ...parsed.recurrences,
            ...parsed.spaces,
            ...parsed.documents,
          ].map((entity) => ({
            taskId: { ...projectResult, ...result }[entity.tempId]!,
            fields: Object.keys(entity).filter((field) => field !== "tempId"),
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
    const defaults = taskDefaults(
      input.rule as unknown as Record<string, unknown>,
    );
    if (
      defaults.activationState === "SCHEDULED" &&
      defaults.activationPolicy !== "AT_SCHEDULED_TIME"
    )
      throw new DomainError("VALIDATION_ERROR");
    if (
      typeof input.rule.descriptionMd !== "string" ||
      input.rule.descriptionMd.length > 200000
    )
      throw new DomainError("VALIDATION_ERROR");
    const rule: RecurrencePayload = {
      ...input.rule,
      ...defaults,
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
      const projectIds = rule.projectIds ?? [];
      rule.projectIds = projectIds;
      for (const projectId of projectIds) {
        const project = await tx.get(projectId);
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
                ...taskDefaults(rule as unknown as Record<string, unknown>),
                title: rule.title,
                descriptionMd: rule.descriptionMd,
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
        ...taskDefaults(rule as unknown as Record<string, unknown>),
        title: rule.title,
        descriptionMd: rule.descriptionMd,
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
