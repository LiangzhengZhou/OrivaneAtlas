import { type ActorContext, DomainError } from "@arclattice/domain";
import type { AiContextItem } from "./ai-context";
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
  get(id: string): Promise<AgentSession>;
  save(session: AgentSession, expected: number): Promise<void>;
}
export class AgentSessionService {
  constructor(
    private readonly store: AgentSessionStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
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
            !["WORK", "NOTE", "SPACE", "DOCUMENT"].includes(source.ref.kind),
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
