import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { noteWikiReferences } from "./note-wiki-references";

export function WikiRelations({
  documentId,
  snapshot,
  onOpen,
  onCreate,
  busy,
}: {
  documentId: string;
  snapshot: Snapshot;
  onOpen(id: string): void;
  onCreate(title: string): void;
  busy: boolean;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const links = snapshot.wikiLinks ?? [];
  const documents = useMemo(
    () =>
      new Map(
        snapshot.library
          .filter((entry) => !entry.deletedAt)
          .map((entry) => [entry.id, entry]),
      ),
    [snapshot.library],
  );
  const noteReferences = useMemo(
    () => noteWikiReferences(snapshot.notes, snapshot.library),
    [snapshot.notes, snapshot.library],
  );
  const backlinks = useMemo(
    () => links.filter((link) => link.targetDocumentId === documentId),
    [links, documentId],
  );
  const broken = useMemo(
    () =>
      links.filter(
        (link) =>
          link.sourceDocumentId === documentId &&
          (!link.targetDocumentId || !documents.has(link.targetDocumentId)),
      ),
    [links, documentId, documents],
  );
  return (
    <aside className="wiki-relations">
      <h3>{zh ? "反向链接" : "Backlinks"}</h3>
      {backlinks.map((link, index) => (
        <Button
          variant="ghost"
          type="button"
          className="text-button"
          key={`${link.sourceDocumentId}:${index}`}
          onClick={() => onOpen(link.sourceDocumentId)}
        >
          {documents.get(link.sourceDocumentId)?.title}
        </Button>
      ))}
      {(["NOTE", "JOURNAL"] as const).map((kind) => (
        <section key={kind}>
          <h4>
            {kind === "NOTE"
              ? zh
                ? "笔记"
                : "Notes"
              : zh
                ? "日记"
                : "Journal"}
          </h4>
          {noteReferences
            .filter(
              (link) =>
                link.targetDocumentId === documentId &&
                link.sourceKind === kind,
            )
            .map((link, index) => (
              <Button
                variant="ghost"
                type="button"
                className="text-button"
                key={link.sourceId + ":" + index}
                onClick={() => onOpen(link.sourceId)}
              >
                {link.sourceTitle}
              </Button>
            ))}
        </section>
      ))}
      <h3>{zh ? "未解析链接" : "Unresolved links"}</h3>
      {broken.map((link, index) => (
        <p key={`${link.targetText}:${index}`}>
          {link.alias ?? link.targetText}
          {!link.targetDocumentId && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => onCreate(link.targetText)}
            >
              {zh ? "创建页面" : "Create page"} · {link.targetText}
            </Button>
          )}
        </p>
      ))}
    </aside>
  );
}
