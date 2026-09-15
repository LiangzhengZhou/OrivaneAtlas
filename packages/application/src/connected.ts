import { type ActorContext, DomainError } from "@arclattice/domain";
import type { AuthorizationService, Clock, IdGenerator } from "./index";

export interface EntityRef {
  kind: "NOTE" | "WORK" | "SPACE" | "DOCUMENT";
  id: string;
}
export interface ConnectedEntity {
  id: string;
  workspaceId: string;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface KnowledgeLink extends ConnectedEntity {
  from: EntityRef;
  to: EntityRef;
  relation: "REFERENCES" | "RELATED";
}
export interface ModelRoute {
  scope?: string;
  fingerprint: string;
  provider: string;
  model: string;
  maxInputChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRunsPerDay: number;
}
export type RunStatus =
  | "WAITING_APPROVAL"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED"
  | "INTERRUPTED";
export interface AgentRun extends ConnectedEntity {
  context?: {
    ref: EntityRef;
    version: number;
    title: string;
    bodyMd: string;
  }[];
  appliedAt?: string;
  prompt: string;
  route: ModelRoute;
  status: RunStatus;
  output: string | null;
  error: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}
/** Store instances are bound to a trusted ActorContext and the current transaction. */
export interface ConnectedStore {
  links(): Promise<KnowledgeLink[]>;
  saveLink(link: KnowledgeLink, expectedVersion: number): Promise<void>;
  exists(ref: EntityRef): Promise<boolean>;
  runs(): Promise<AgentRun[]>;
  getRun(id: string): Promise<AgentRun>;
  saveRun(run: AgentRun, expectedVersion: number): Promise<void>;
}
export interface ModelPort {
  route: ModelRoute;
  complete(prompt: string, signal: AbortSignal): Promise<string>;
}
export class ConnectedService {
  constructor(
    private readonly store: ConnectedStore,
    private readonly auth: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  private base(context: ActorContext): ConnectedEntity {
    const now = this.clock.now();
    return {
      id: this.ids.next(),
      workspaceId: context.workspaceId,
      version: 1,
      createdBy: context.principalId,
      updatedBy: context.principalId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }
  async link(
    context: ActorContext,
    from: EntityRef,
    to: EntityRef,
    relation: KnowledgeLink["relation"],
  ) {
    await this.auth.require(context, "graph:write");
    if (
      ![from, to].every(
        (r) =>
          ["NOTE", "WORK", "SPACE", "DOCUMENT"].includes(r.kind) &&
          typeof r.id === "string" &&
          r.id.length > 0 &&
          r.id.length <= 240,
      ) ||
      !["REFERENCES", "RELATED"].includes(relation) ||
      (from.kind === to.kind && from.id === to.id)
    )
      throw new DomainError("VALIDATION_ERROR");
    if (!(await this.store.exists(from)) || !(await this.store.exists(to)))
      throw new DomainError("NOT_FOUND");
    const same = (a: EntityRef, b: EntityRef) =>
      a.kind === b.kind && a.id === b.id;
    if (
      (await this.store.links()).some(
        (l) =>
          !l.deletedAt &&
          l.relation === relation &&
          ((same(l.from, from) && same(l.to, to)) ||
            (relation === "RELATED" && same(l.from, to) && same(l.to, from))),
      )
    )
      throw new DomainError("DUPLICATE_EDGE");
    const link = { ...this.base(context), from, to, relation };
    await this.store.saveLink(link, 0);
    return link;
  }
  async unlink(context: ActorContext, id: string, version: number) {
    await this.auth.require(context, "graph:write");
    const old = (await this.store.links()).find((l) => l.id === id);
    if (!old || old.workspaceId !== context.workspaceId)
      throw new DomainError("NOT_FOUND");
    const link = {
      ...old,
      version: old.version + 1,
      deletedAt: this.clock.now(),
      updatedAt: this.clock.now(),
      updatedBy: context.principalId,
    };
    await this.store.saveLink(link, version);
    return link;
  }
  async propose(
    context: ActorContext,
    prompt: string,
    route: ModelRoute,
    sources: NonNullable<AgentRun["context"]> = [],
  ) {
    await this.auth.require(context, "work:create");
    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > route.maxInputChars
    )
      throw new DomainError("VALIDATION_ERROR");
    const run: AgentRun = {
      ...this.base(context),
      prompt,
      context: sources,
      route,
      status: "WAITING_APPROVAL",
      output: null,
      error: null,
      approvedBy: null,
      approvedAt: null,
    };
    await this.store.saveRun(run, 0);
    return run;
  }
  async decide(
    context: ActorContext,
    id: string,
    version: number,
    approve: boolean,
    route: ModelRoute | null,
  ) {
    await this.auth.require(context, "work:update");
    const old = await this.store.getRun(id);
    if (old.workspaceId !== context.workspaceId || old.deletedAt)
      throw new DomainError("NOT_FOUND");
    if (old.status !== "WAITING_APPROVAL" || old.version !== version)
      throw new DomainError("VERSION_CONFLICT");
    if (approve) {
      if (!route || route.fingerprint !== old.route.fingerprint)
        throw new DomainError("VERSION_CONFLICT");
      const runs = await this.store.runs();
      if (
        runs.some((r) => r.status === "RUNNING") ||
        runs.filter(
          (r) => r.approvedAt?.slice(0, 10) === this.clock.now().slice(0, 10),
        ).length >= route.maxRunsPerDay
      )
        throw new DomainError("FORBIDDEN");
    }
    const run: AgentRun = {
      ...old,
      version: old.version + 1,
      status: approve ? "RUNNING" : "REJECTED",
      updatedAt: this.clock.now(),
      updatedBy: context.principalId,
      approvedBy: approve ? context.principalId : null,
      approvedAt: approve ? this.clock.now() : null,
    };
    await this.store.saveRun(run, version);
    return run;
  }
  async finish(
    context: ActorContext,
    id: string,
    output: string | null,
    error: string | null,
    interrupted = false,
  ) {
    await this.auth.require(context, "work:update");
    const old = await this.store.getRun(id);
    if (old.workspaceId !== context.workspaceId || old.status !== "RUNNING")
      throw new DomainError("VERSION_CONFLICT");
    if (
      output !== null &&
      (typeof output !== "string" || output.length > 100_000)
    )
      throw new DomainError("VALIDATION_ERROR");
    const run: AgentRun = {
      ...old,
      version: old.version + 1,
      output,
      error,
      status: interrupted ? "INTERRUPTED" : error ? "FAILED" : "SUCCEEDED",
      updatedAt: this.clock.now(),
      updatedBy: context.principalId,
    };
    await this.store.saveRun(run, old.version);
    return run;
  }
}
