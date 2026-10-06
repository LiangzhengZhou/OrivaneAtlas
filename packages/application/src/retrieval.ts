import type { ActorContext } from "@arclattice/domain";
import type { AuthorizationService } from "./index";
import type { DocumentWikiLink, LibraryEntry, LibraryStore } from "./library";
import type { NotebookStore } from "./notebook";
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
  async searchNoteIds(
    context: ActorContext,
    query: string,
    notes: NotebookStore,
  ): Promise<string[]> {
    await this.authorization.require(context, "work:read");
    if (notes.searchIds) return notes.searchIds(query);
    const text = query.toLocaleLowerCase();
    return (await notes.list())
      .filter(
        (note) =>
          note.workspaceId === context.workspaceId &&
          !note.deletedAt &&
          (note.title + " " + note.bodyMd).toLocaleLowerCase().includes(text),
      )
      .map((note) => note.id);
  }
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
    const semanticById = new Map<string, number>();
    for (const entry of semantic) {
      if (!semanticById.has(entry.id)) semanticById.set(entry.id, entry.score);
    }
    const linkCountById = new Map<string, number>();
    for (const link of links) {
      const endpoints = new Set([link.sourceDocumentId, link.targetDocumentId]);
      for (const id of endpoints) {
        if (id) linkCountById.set(id, (linkCountById.get(id) ?? 0) + 1);
      }
    }
    const spaceOrder = new Map(scope.spaceIds.map((id, index) => [id, index]));
    const now = Date.now();
    return documents
      .map((document) => {
        const title = (
          document.title +
          " " +
          (document.aliases ?? []).join(" ")
        ).toLocaleLowerCase();
        const body = document.bodyMd.toLocaleLowerCase();
        const searchText = (
          document.title +
          document.bodyMd +
          (document.aliases ?? []).join(" ")
        ).toLocaleLowerCase();
        return {
          document,
          matches:
            !terms.length ||
            terms.some((term) => searchText.includes(term)) ||
            semanticById.has(document.id) ||
            relatedIds.has(document.id),
          score:
            terms.reduce(
              (score, term) =>
                score +
                (title.includes(term) ? 8 : 0) +
                (body.includes(term) ? 2 : 0),
              0,
            ) +
            (semanticById.get(document.id) ?? 0) +
            (relatedIds.has(document.id) ? 3 : 0) +
            (linkCountById.get(document.id) ?? 0) * 0.1 +
            1 /
              (1 +
                Math.max(0, now - (Date.parse(document.updatedAt) || 0)) /
                  86400000) +
            1 / (1 + (spaceOrder.get(document.spaceId ?? "") ?? -1)),
        };
      })
      .filter((result) => result.matches)
      .sort(
        (left, right) =>
          (spaceOrder.get(left.document.spaceId ?? "") ?? -1) -
            (spaceOrder.get(right.document.spaceId ?? "") ?? -1) ||
          right.score - left.score ||
          right.document.updatedAt.localeCompare(left.document.updatedAt),
      )
      .slice(0, Math.max(1, Math.min(limit, 50)))
      .map(({ document, score }) => ({ document, score }));
  }
}
