import { type ActorContext, DomainError } from "@arclattice/domain";
import {
  type AiCapability,
  aiCapabilities,
  type ExecutionApproval,
  requiresExecutionApproval,
} from "./ai-context";
import type { ConnectedService } from "./connected";
import type { AuthorizationService, WorkService } from "./index";
import type { LibraryEntry, LibraryService, LibraryStore } from "./library";
import type { ProjectKnowledgeScope } from "./project-knowledge-scope";
import type { RetrievalResult, RetrievalService } from "./retrieval";

export type AiCapabilityCall =
  | {
      name: "search_documents";
      query: string;
      scope: ProjectKnowledgeScope;
      currentDocumentIds?: readonly string[];
    }
  | { name: "read_document"; id: string }
  | { name: "get_project"; id: string }
  | { name: "list_project_tasks"; projectId: string }
  | { name: "create_task"; title: string; projectIds?: string[] }
  | { name: "propose_document_edit"; id: string; markdown: string }
  | { name: "link_documents"; fromId: string; toId: string };

export function parseAiCapabilityCall(
  name: string,
  input: Record<string, unknown>,
  scope: ProjectKnowledgeScope,
): AiCapabilityCall {
  const text = (key: string, max = 240) => {
    const value = input[key];
    if (typeof value !== "string" || !value.trim() || value.length > max)
      throw new DomainError("VALIDATION_ERROR");
    return value;
  };
  const allowed: Record<string, string[]> = {
    search_documents: ["query", "projectId", "currentSpaceId"],
    read_document: ["id"],
    get_project: ["id"],
    list_project_tasks: ["projectId"],
    create_task: ["title", "projectIds"],
    propose_document_edit: ["id", "markdown"],
    link_documents: ["fromId", "toId"],
  };
  if (
    !allowed[name] ||
    Object.keys(input).some((key) => !allowed[name]!.includes(key))
  )
    throw new DomainError("VALIDATION_ERROR");
  switch (name) {
    case "search_documents":
      return { name, query: text("query", 10000), scope };
    case "read_document":
    case "get_project":
      return { name, id: text("id") };
    case "list_project_tasks":
      return { name, projectId: text("projectId") };
    case "create_task": {
      const projectIds = input.projectIds;
      if (
        projectIds !== undefined &&
        (!Array.isArray(projectIds) ||
          projectIds.length > 100 ||
          projectIds.some(
            (id) => typeof id !== "string" || !id || id.length > 240,
          ))
      )
        throw new DomainError("VALIDATION_ERROR");
      return {
        name,
        title: text("title"),
        ...(projectIds ? { projectIds: projectIds as string[] } : {}),
      };
    }
    case "propose_document_edit":
      return { name, id: text("id"), markdown: text("markdown", 200000) };
    case "link_documents":
      return { name, fromId: text("fromId"), toId: text("toId") };
    default:
      throw new DomainError("VALIDATION_ERROR");
  }
}

export class AiCapabilityService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly work: WorkService,
    private readonly library: LibraryStore,
    private readonly documents: LibraryService,
    readonly retrieval: RetrievalService,
    private readonly connected?: ConnectedService,
    private readonly externalDisclosure = false,
  ) {}
  private async readableDocument(
    context: ActorContext,
    document: LibraryEntry,
  ) {
    if (
      document.workspaceId !== context.workspaceId ||
      document.deletedAt ||
      document.kind !== "DOCUMENT"
    )
      return false;
    const space = document.spaceId
      ? await this.library.get(document.spaceId)
      : null;
    if (
      !space ||
      space.deletedAt ||
      space.workspaceId !== context.workspaceId ||
      space.kind !== "SPACE"
    )
      return false;
    return [document, space].every(
      (entry) =>
        entry.aiPolicy &&
        entry.aiPolicy.aiAccess !== "DENY" &&
        (!this.externalDisclosure ||
          (entry.aiPolicy.aiAccess === "ALLOW" &&
            entry.aiPolicy.processingBoundary === "ANY" &&
            entry.aiPolicy.classification !== "SECRET")),
    );
  }
  async searchDocuments(
    context: ActorContext,
    query: string,
    scope: ProjectKnowledgeScope,
    currentDocumentIds: readonly string[] = [],
  ) {
    await this.authorize(
      context,
      { name: "search_documents", risk: "READ" },
      "REVIEW_WRITES",
      false,
    );
    const candidates = (await this.library.list()).filter((entry) =>
      scope.documentIds.includes(entry.id),
    );
    const permitted = await Promise.all(
      candidates.map((entry) => this.readableDocument(context, entry)),
    );
    const permittedScope = {
      ...scope,
      documentIds: candidates
        .filter((_entry, index) => permitted[index])
        .map((entry) => entry.id),
    };
    const results = (
      await this.retrieval.search(
        context,
        query,
        permittedScope,
        (await this.library.wikiLinks?.()) ?? [],
        12,
        currentDocumentIds,
      )
    ).filter(
      (result) =>
        result.document.aiPolicy &&
        result.document.aiPolicy.aiAccess !== "DENY",
    );
    const readable = await Promise.all(
      results.map((result) => this.readableDocument(context, result.document)),
    );
    return results.filter((_result, index) => readable[index]);
  }
  execute(
    context: ActorContext,
    call: Extract<AiCapabilityCall, { name: "search_documents" }>,
    approval: ExecutionApproval,
    approved: boolean,
  ): Promise<RetrievalResult[]>;
  execute(
    context: ActorContext,
    call: AiCapabilityCall,
    approval: ExecutionApproval,
    approved: boolean,
  ): Promise<unknown>;
  async execute(
    context: ActorContext,
    call: AiCapabilityCall,
    approval: ExecutionApproval,
    approved: boolean,
  ) {
    const capability = aiCapabilities.find((entry) => entry.name === call.name);
    if (!capability) throw new DomainError("VALIDATION_ERROR");
    await this.authorize(context, capability, approval, approved);
    switch (call.name) {
      case "search_documents":
        return this.searchDocuments(
          context,
          call.query,
          call.scope,
          call.currentDocumentIds,
        );
      case "read_document":
        return this.readDocument(context, call.id);
      case "get_project":
        return this.getProject(context, call.id);
      case "list_project_tasks":
        return this.listProjectTasks(context, call.projectId);
      case "create_task":
        return this.createTask(context, {
          title: call.title,
          ...(call.projectIds ? { projectIds: call.projectIds } : {}),
        });
      case "propose_document_edit":
        return this.proposeDocumentEdit(context, call.id, call.markdown);
      case "link_documents": {
        await this.readDocument(context, call.fromId);
        await this.readDocument(context, call.toId);
        if (!this.connected) throw new DomainError("FORBIDDEN");
        return this.connected.link(
          context,
          { kind: "DOCUMENT", id: call.fromId },
          { kind: "DOCUMENT", id: call.toId },
          "REFERENCES",
        );
      }
    }
  }
  async authorize(
    context: ActorContext,
    capability: AiCapability,
    approval: ExecutionApproval,
    approved: boolean,
  ) {
    await this.authorization.require(
      context,
      capability.risk === "READ"
        ? "work:read"
        : capability.risk === "DESTRUCTIVE"
          ? "work:delete"
          : capability.name === "create_task"
            ? "work:create"
            : "work:update",
    );
    if (requiresExecutionApproval(capability.risk, approval) && !approved)
      throw new DomainError("FORBIDDEN");
  }
  async readDocument(context: ActorContext, id: string) {
    await this.authorization.require(context, "work:read");
    const document = await this.library.get(id);
    if (!(await this.readableDocument(context, document)))
      throw new DomainError("FORBIDDEN");
    return document;
  }
  async getProject(context: ActorContext, id: string) {
    const snapshot = await this.work.snapshot(context);
    const project = snapshot.items.find(
      (item) => item.id === id && item.type === "PROJECT" && !item.deletedAt,
    );
    if (!project) throw new DomainError("NOT_FOUND");
    return project;
  }
  async listProjectTasks(context: ActorContext, projectId: string) {
    await this.getProject(context, projectId);
    return (await this.work.snapshot(context)).items.filter(
      (item) =>
        item.type === "TASK" &&
        !item.deletedAt &&
        item.projectIds?.includes(projectId),
    );
  }
  async createTask(
    context: ActorContext,
    input: { title: string; projectIds?: string[] },
  ) {
    return this.work.create(context, { ...input, type: "TASK" });
  }
  async proposeDocumentEdit(
    context: ActorContext,
    id: string,
    markdown: string,
  ) {
    const document = await this.readDocument(context, id);
    return {
      id,
      version: document.version,
      before: document.bodyMd,
      after: markdown,
    };
  }
  async applyDocumentEdit(
    context: ActorContext,
    id: string,
    version: number,
    markdown: string,
    title?: string,
  ) {
    await this.authorize(
      context,
      { name: "propose_document_edit", risk: "WRITE" },
      "REVIEW_WRITES",
      true,
    );
    const document = await this.readDocument(context, id);
    return this.documents.save(context, id, version, {
      ...document,
      bodyMd: markdown,
      ...(title ? { title } : {}),
    });
  }
}
