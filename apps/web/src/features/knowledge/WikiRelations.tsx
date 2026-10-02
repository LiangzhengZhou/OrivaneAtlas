import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
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
  const backlinks = links.filter(
    (link) => link.targetDocumentId === documentId,
  );
  const broken = links.filter(
    (link) =>
      link.sourceDocumentId === documentId &&
      (!link.targetDocumentId ||
        !snapshot.library.some(
          (entry) => entry.id === link.targetDocumentId && !entry.deletedAt,
        )),
  );
  return (
    <aside className="wiki-relations">
      <h3>{zh ? "反向链接" : "Backlinks"}</h3>
      {backlinks.map((link, index) => (
        <button
          type="button"
          className="text-button"
          key={`${link.sourceDocumentId}:${index}`}
          onClick={() => onOpen(link.sourceDocumentId)}
        >
          {
            snapshot.library.find((entry) => entry.id === link.sourceDocumentId)
              ?.title
          }
        </button>
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
          {noteWikiReferences(snapshot.notes, snapshot.library)
            .filter(
              (link) =>
                link.targetDocumentId === documentId &&
                link.sourceKind === kind,
            )
            .map((link, index) => (
              <button
                type="button"
                className="text-button"
                key={link.sourceId + ":" + index}
                onClick={() => onOpen(link.sourceId)}
              >
                {link.sourceTitle}
              </button>
            ))}
        </section>
      ))}
      <h3>{zh ? "未解析链接" : "Unresolved links"}</h3>
      {broken.map((link, index) => (
        <p key={`${link.targetText}:${index}`}>
          {link.alias ?? link.targetText}
          {!link.targetDocumentId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onCreate(link.targetText)}
            >
              {zh ? "创建页面" : "Create page"} · {link.targetText}
            </button>
          )}
        </p>
      ))}
    </aside>
  );
}
