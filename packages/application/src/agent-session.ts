import {
  type ActorContext,
  DomainError,
  entityMemoTargetKinds,
} from "@arclattice/domain";
import type { AiContextItem } from "./ai-context";
import type { AgentRun, ConnectedStore } from "./connected";
import type { AuthorizationService, Clock, IdGenerator } from "./index";

export interface AgentSessionMessage {
  evidence?: Pick<AiContextItem, "ref" | "title" | "version" | "source">[];
  id: string;
  kind:
    | "USER"
    | "ASSISTANT"
    | "TOOL_CALL"
    | "TOOL_RESULT"
    | "PROPOSAL"
    | "ERROR";
  text: string;
  runId: string | null;
  createdAt: string;
}
export interface AgentSession {
  projectId?: string | null;
  spaceId?: string | null;
  archivedAt?: string | null;
  modelProfileOverride?: string | null;
  id: string;
  workspaceId: string;
  createdBy: string;
  version: number;
  title: string;
  messages: AgentSessionMessage[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface AgentSessionStore {
  list(): Promise<AgentSession[]>;
  summaries(): Promise<AgentSessionSummary[]>;
  page(
    id: string,
    before: number | null,
    limit: number,
  ): Promise<AgentSessionPage>;
  get(id: string): Promise<AgentSession>;
  save(session: AgentSession, expected: number): Promise<void>;
}
export interface AgentSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  projectId: string | null;
  spaceId: string | null;
  archivedAt: string | null;
  messageCount: number;
  preview: string;
}
export interface AgentSessionPage {
  session: AgentSession;
  before: number;
  hasMore: boolean;
}
export function agentSessionSummary(
  session: AgentSession,
): AgentSessionSummary {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    projectId: session.projectId ?? null,
    spaceId: session.spaceId ?? null,
    archivedAt: session.archivedAt ?? null,
    messageCount: session.messages.length,
    preview: session.messages.at(-1)?.text.slice(0, 160) ?? "",
  };
}
export class AgentSessionService {
  constructor(
    private readonly store: AgentSessionStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  /** Caller supplies only canonical run references, never fabricated messages.
   * The outer UnitOfWork commits session/messages/run binding atomically. */
  async promoteRuns(
    actorInput: ActorContext,
    runs: Pick<ConnectedStore, "getRun" | "saveRun">,
    title: string,
    input: { id: string; version: number }[],
  ) {
    const actor = Object.freeze({ ...actorInput }),
      references = structuredClone(input);
    await this.authorization.require(actor, "work:read");
    await this.authorization.require(actor, "work:create");
    await this.authorization.require(actor, "work:update");
    if (
      !Array.isArray(references) ||
      !references.length ||
      references.length > 20 ||
      references.some((ref) => !ref || typeof ref.id !== "string") ||
      new Set(references.map((ref) => ref.id)).size !== references.length
    )
      throw new DomainError("VALIDATION_ERROR");
    const canonical: AgentRun[] = [];
    for (const ref of references) {
      if (
        !ref ||
        typeof ref.id !== "string" ||
        !ref.id ||
        ref.id.length > 240 ||
        !Number.isSafeInteger(ref.version) ||
        ref.version < 1
      )
        throw new DomainError("VALIDATION_ERROR");
      const run = await runs.getRun(ref.id);
      if (
        run.workspaceId !== actor.workspaceId ||
        run.createdBy !== actor.principalId ||
        run.deletedAt
      )
        throw new DomainError("NOT_FOUND");
      if (
        run.version !== ref.version ||
        run.status !== "SUCCEEDED" ||
        run.sessionId
      )
        throw new DomainError("VERSION_CONFLICT");
      if (
        !run.userPrompt ||
        !run.output ||
        run.userPrompt.length > 200000 ||
        run.output.length > 200000
      )
        throw new DomainError("VALIDATION_ERROR");
      canonical.push(run);
    }
    let session = await this.create(actor, title);
    for (const run of canonical) {
      session = await this.append(actor, session.id, session.version, {
        kind: "USER",
        text: run.userPrompt!,
        runId: run.id,
      });
      session = await this.append(actor, session.id, session.version, {
        kind: "ASSISTANT",
        text: run.output!,
        runId: run.id,
        evidence:
          run.context?.map((item) => ({
            ref: item.ref,
            title: item.title,
            version: item.version,
            source: item.source ?? "current",
          })) ?? [],
      });
      await runs.saveRun(
        {
          ...run,
          version: run.version + 1,
          sessionId: session.id,
          sessionVersion: session.version,
          updatedAt: this.clock.now(),
          updatedBy: actor.principalId,
        },
        run.version,
      );
    }
    return session;
  }
  async summaries(actor: ActorContext) {
    await this.authorization.require(actor, "work:read");
    return this.store.summaries();
  }
  async page(
    actor: ActorContext,
    id: string,
    before: number | null = null,
    limit = 50,
  ) {
    await this.authorization.require(actor, "work:read");
    if (
      (before !== null && (!Number.isSafeInteger(before) || before < 0)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new DomainError("VALIDATION_ERROR");
    const result = await this.store.page(id, before, limit);
    if (
      result.session.workspaceId !== actor.workspaceId ||
      result.session.createdBy !== actor.principalId ||
      result.session.deletedAt
    )
      throw new DomainError("NOT_FOUND");
    return result;
  }
  async update(
    actor: ActorContext,
    id: string,
    expected: number,
    changes: {
      title?: string;
      archivedAt?: string | null;
      deletedAt?: string | null;
      projectId?: string | null;
      spaceId?: string | null;
    },
  ) {
    await this.authorization.require(actor, "work:update");
    const previous = await this.store.get(id);
    if (
      previous.workspaceId !== actor.workspaceId ||
      previous.createdBy !== actor.principalId
    )
      throw new DomainError("NOT_FOUND");
    if (previous.version !== expected)
      throw new DomainError("VERSION_CONFLICT");
    if (
      changes.title !== undefined &&
      (!changes.title.trim() || changes.title.length > 240)
    )
      throw new DomainError("VALIDATION_ERROR");
    const session = {
      ...previous,
      ...changes,
      ...(changes.title === undefined ? {} : { title: changes.title.trim() }),
      version: expected + 1,
      updatedAt: this.clock.now(),
    };
    await this.store.save(session, expected);
    return session;
  }
  async list(actor: ActorContext) {
    await this.authorization.require(actor, "work:read");
    return (await this.store.list())
      .filter(
        (session) =>
          session.workspaceId === actor.workspaceId &&
          session.createdBy === actor.principalId &&
          !session.deletedAt,
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.createdAt.localeCompare(left.createdAt),
      );
  }
  async get(actor: ActorContext, id: string) {
    await this.authorization.require(actor, "work:read");
    const session = await this.store.get(id);
    if (
      session.workspaceId !== actor.workspaceId ||
      session.createdBy !== actor.principalId ||
      session.deletedAt
    )
      throw new DomainError("NOT_FOUND");
    return session;
  }
  async create(
    actor: ActorContext,
    title: string,
    modelProfileOverride: string | null = null,
  ) {
    await this.authorization.require(actor, "work:create");
    if (typeof title !== "string" || !title.trim() || title.length > 240)
      throw new DomainError("VALIDATION_ERROR");
    if (
      modelProfileOverride !== null &&
      !/^[a-zA-Z0-9_-]{1,64}$/.test(modelProfileOverride)
    )
      throw new DomainError("VALIDATION_ERROR");
    const now = this.clock.now();
    const session: AgentSession = {
      id: this.ids.next(),
      workspaceId: actor.workspaceId,
      createdBy: actor.principalId,
      version: 1,
      title: title.trim(),
      modelProfileOverride,
      messages: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.store.save(session, 0);
    return session;
  }
  async setModelProfile(
    actor: ActorContext,
    id: string,
    expected: number,
    profileId: string | null,
  ) {
    await this.authorization.require(actor, "work:update");
    const previous = await this.get(actor, id);
    if (previous.version !== expected)
      throw new DomainError("VERSION_CONFLICT");
    if (profileId !== null && !/^[a-zA-Z0-9_-]{1,64}$/.test(profileId))
      throw new DomainError("VALIDATION_ERROR");
    const session = {
      ...previous,
      modelProfileOverride: profileId,
      version: expected + 1,
      updatedAt: this.clock.now(),
    };
    await this.store.save(session, expected);
    return session;
  }
  async append(
    actor: ActorContext,
    id: string,
    expected: number,
    message: Pick<AgentSessionMessage, "kind" | "text" | "runId" | "evidence">,
  ) {
    await this.authorization.require(actor, "work:update");
    const previous = await this.get(actor, id);
    if (previous.version !== expected)
      throw new DomainError("VERSION_CONFLICT");
    if (
      !message.text ||
      message.text.length > 200000 ||
      previous.messages.length >= 1000 ||
      ![
        "USER",
        "ASSISTANT",
        "TOOL_CALL",
        "TOOL_RESULT",
        "PROPOSAL",
        "ERROR",
      ].includes(message.kind)
    )
      throw new DomainError("VALIDATION_ERROR");
    if (
      message.evidence !== undefined &&
      (message.kind !== "ASSISTANT" ||
        !Array.isArray(message.evidence) ||
        message.evidence.length > 20 ||
        message.evidence.some(
          (source) =>
            !source ||
            typeof source.title !== "string" ||
            source.title.length > 1000 ||
            !Number.isSafeInteger(source.version) ||
            source.version < 1 ||
            ![
              "current",
              "selected",
              "retrieved",
              "linked",
              "mentioned",
            ].includes(source.source) ||
            !source.ref ||
            typeof source.ref.id !== "string" ||
            !source.ref.id ||
            source.ref.id.length > 240 ||
            (source.ref.kind === "MEMO"
              ? !source.ref.target ||
                Object.keys(source.ref.target).some(
                  (key) => !["targetKind", "targetId"].includes(key),
                ) ||
                !entityMemoTargetKinds.includes(source.ref.target.targetKind) ||
                typeof source.ref.target.targetId !== "string" ||
                !source.ref.target.targetId ||
                source.ref.target.targetId.length > 240
              : !["WORK", "NOTE", "SPACE", "DOCUMENT", "FILE"].includes(
                  source.ref.kind,
                )),
        ))
    )
      throw new DomainError("VALIDATION_ERROR");
    const now = this.clock.now();
    const session: AgentSession = {
      ...previous,
      version: expected + 1,
      updatedAt: now,
      messages: [
        ...previous.messages,
        { ...message, id: this.ids.next(), createdAt: now },
      ],
    };
    await this.store.save(session, expected);
    return session;
  }
}
