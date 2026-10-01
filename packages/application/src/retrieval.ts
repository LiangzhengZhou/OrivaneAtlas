import type { ActorContext } from "@arclattice/domain";
import type { AuthorizationService } from "./index";
import type { DocumentWikiLink, LibraryEntry, LibraryStore } from "./library";
import type { ProjectKnowledgeScope } from "./project-knowledge-scope";

export interface RetrievalResult {
  document: LibraryEntry;
  score: number;
}
export interface SemanticRetrievalPort {
  search(
    context: ActorContext,
    query: string,
    documentIds: readonly string[],
  ): Promise<{ id: string; score: number }[]>;
}
export class RetrievalService {
  constructor(
    private readonly library: Pick<LibraryStore, "list">,
    private readonly authorization: AuthorizationService,
    private readonly semantic?: SemanticRetrievalPort,
  ) {}
  async search(
    context: ActorContext,
    query: string,
    scope: ProjectKnowledgeScope,
    links: readonly DocumentWikiLink[] = [],
    limit = 12,
    currentDocumentIds: readonly string[] = [],
  ): Promise<RetrievalResult[]> {
    await this.authorization.require(context, "work:read");
    const ids = new Set(scope.documentIds);
    const documents = (await this.library.list()).filter(
      (document) =>
        document.workspaceId === context.workspaceId &&
        document.kind === "DOCUMENT" &&
        !document.deletedAt &&
        ids.has(document.id),
    );
    const terms = query
      .toLocaleLowerCase()
      .replace(/\[\[|\]\]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const relatedIds = new Set(
      links.flatMap((link) =>
        currentDocumentIds.includes(link.sourceDocumentId) &&
        link.targetDocumentId
          ? [link.targetDocumentId]
          : link.targetDocumentId &&
              currentDocumentIds.includes(link.targetDocumentId)
            ? [link.sourceDocumentId]
            : [],
      ),
    );
    const semantic =
      (await this.semantic?.search(
        context,
        query,
        documents.map((document) => document.id),
      )) ?? [];
    return documents
      .map((document) => ({
        document,
        score:
          terms.reduce(
            (score, term) =>
              score +
              ((document.title + " " + (document.aliases ?? []).join(" "))
                .toLocaleLowerCase()
                .includes(term)
                ? 8
                : 0) +
              (document.bodyMd.toLocaleLowerCase().includes(term) ? 2 : 0),
            0,
          ) +
          (semantic.find((entry) => entry.id === document.id)?.score ?? 0) +
          (relatedIds.has(document.id) ? 3 : 0) +
          links.filter(
            (link) =>
              link.targetDocumentId === document.id ||
              link.sourceDocumentId === document.id,
          ).length *
            0.1 +
          1 /
            (1 +
              Math.max(0, Date.now() - (Date.parse(document.updatedAt) || 0)) /
                86400000) +
          1 / (1 + scope.spaceIds.indexOf(document.spaceId ?? "")),
      }))
      .filter(
        (result) =>
          !terms.length ||
          terms.some((term) =>
            (
              result.document.title +
              result.document.bodyMd +
              (result.document.aliases ?? []).join(" ")
            )
              .toLocaleLowerCase()
              .includes(term),
          ) ||
          semantic.some((entry) => entry.id === result.document.id) ||
          relatedIds.has(result.document.id),
      )
      .sort(
        (left, right) =>
          scope.spaceIds.indexOf(left.document.spaceId ?? "") -
            scope.spaceIds.indexOf(right.document.spaceId ?? "") ||
          right.score - left.score ||
          right.document.updatedAt.localeCompare(left.document.updatedAt),
      )
      .slice(0, Math.max(1, Math.min(limit, 50)));
  }
}
