import type { LibraryEntry } from "@arclattice/application";
import { BookOpen, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "./app/ToastHost";
import type { Runtime, Snapshot } from "./bootstrap";
import type { DocumentRequest } from "./DocumentWorkspace";
import { KnowledgeGraph } from "./features/knowledge/KnowledgeGraph";
import { Markdown } from "./Markdown";
export function LibraryView({
  runtime,
  onOpen,
  snapshot,
  onChanged,
  onTrash,
}: {
  runtime: Runtime;
  onOpen: (request: DocumentRequest) => void;
  snapshot: Snapshot;
  onChanged(): Promise<void>;
  onTrash(): void;
}) {
  const { t } = useTranslation("spaces");
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [graphOpen, setGraphOpen] = useState(false);
  const entries = snapshot.library;
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const [spaceId, setSpaceId] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await action();
      await onChanged();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const spaces = entries.filter((e) => e.kind === "SPACE" && !e.deletedAt),
    space = spaces.find((e) => e.id === spaceId);
  const docs = entries.filter(
    (e) =>
      e.kind === "DOCUMENT" &&
      !e.deletedAt &&
      e.spaceId === spaceId &&
      (e.title + " " + e.bodyMd).toLowerCase().includes(query.toLowerCase()),
  );
  const paths = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const document of entries) {
      const ancestors: string[] = [];
      const visited = new Set([document.id]);
      let parentId = document.parentDocumentId;
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = entriesById.get(parentId);
        if (!parent || parent.deletedAt || parent.spaceId !== document.spaceId)
          break;
        ancestors.unshift(parent.title);
        parentId = parent.parentDocumentId;
      }
      result.set(document.id, ancestors);
    }
    return result;
  }, [entries, entriesById]);
  const hierarchy = (document: LibraryEntry) => paths.get(document.id) ?? [];
  docs.sort((left, right) =>
    [...hierarchy(left), left.title]
      .join("/")
      .localeCompare([...hierarchy(right), right.title].join("/")),
  );
  function open(entity?: LibraryEntry) {
    const kind = entity?.kind ?? (space ? "DOCUMENT" : "SPACE");
    onOpen({
      key: entity?.id ?? crypto.randomUUID(),
      kind,
      entity,
      spaceId: entity?.spaceId ?? (kind === "DOCUMENT" ? spaceId : null),
    });
  }
  return (
    <div className="library-view">
      {error && (
        <p className="error" role="alert">
          {t("error")}
        </p>
      )}
      {graphOpen && (
        <KnowledgeGraph
          key={spaceId ?? "workspace"}
          snapshot={snapshot}
          currentSpaceId={spaceId ?? undefined}
          onOpen={(ref) => {
            const entity = entriesById.get(ref.id);
            if (entity)
              onOpen({
                key: entity.id,
                kind: entity.kind,
                entity,
                spaceId: entity.spaceId,
              });
          }}
        />
      )}
      <div className="library-toolbar action-row">
        <button
          type="button"
          className="chip"
          aria-pressed={graphOpen}
          onClick={() => setGraphOpen(!graphOpen)}
        >
          {zh ? "知识图谱" : "Knowledge graph"}
        </button>

        <button
          className="button secondary"
          type="button"
          onClick={() => setSpaceId(null)}
        >
          {t("back")}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => void run(async () => {})}
        >
          {t("refresh")}
        </button>
        <button className="button primary" type="button" onClick={() => open()}>
          <Plus size={16} />
          {t(space ? "newLecture" : "newSpace")}
        </button>
      </div>
      {space ? (
        <>
          <section className="panel account-panel">
            <p className="eyebrow">{t("library")}</p>
            <h2>{space.title}</h2>
            <Markdown text={space.bodyMd} />
            <div className="action-row">
              <button
                className="button secondary"
                type="button"
                onClick={() => open(space)}
              >
                {t("edit")}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const deleted = await runtime.deleteLibrary(
                      space.id,
                      space.version,
                      true,
                    );
                    showToast(
                      zh ? "已移至回收站" : "Moved to Trash",
                      async () => {
                        await runtime.deleteLibrary(
                          deleted.id,
                          deleted.version,
                          false,
                        );
                        await onChanged();
                      },
                    );
                    setSpaceId(null);
                  })
                }
              >
                {t("delete")}
              </button>
            </div>
          </section>
          <label className="field">
            {t("search")}
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="note-grid">
            {docs.map((doc) => (
              <button
                className="note-card"
                type="button"
                key={doc.id}
                style={{ marginInlineStart: `${hierarchy(doc).length * 16}px` }}
                onClick={() => open(doc)}
              >
                <BookOpen size={20} />
                <h3>{doc.title}</h3>
                {hierarchy(doc).length > 0 && (
                  <small>{hierarchy(doc).join(" / ")}</small>
                )}
                <p>{doc.bodyMd.slice(0, 140)}</p>
                <footer>
                  {t(doc.provenance)} · v{doc.version}
                </footer>
              </button>
            ))}
          </div>
          {!docs.length && <p>{t("empty")}</p>}{" "}
        </>
      ) : (
        <>
          <p className="subtitle">{t("spaceHint")}</p>
          <div className="note-grid">
            {spaces.map((item) => (
              <button
                className="note-card space-card"
                type="button"
                key={item.id}
                onClick={() => setSpaceId(item.id)}
              >
                <BookOpen size={24} />
                <h2>{item.title}</h2>
                <p>{item.bodyMd.slice(0, 160)}</p>
                <footer>
                  {
                    entries.filter((e) => e.spaceId === item.id && !e.deletedAt)
                      .length
                  }{" "}
                  {t("documentCount")}
                </footer>
              </button>
            ))}
          </div>
        </>
      )}
      <button type="button" className="text-button" onClick={onTrash}>
        {zh ? "查看回收站 →" : "View Trash →"}
      </button>
    </div>
  );
}
