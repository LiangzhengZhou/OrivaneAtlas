import type { WorkspaceLibraryEntry as LibraryEntry } from "@arclattice/application";
import { BookOpen, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEntitySelection } from "./app/EntitySelection";
import { showToast } from "./app/ToastHost";
import type { Runtime, Snapshot } from "./bootstrap";
import { Button } from "./components/ui/Button";
import { ListRow, ListSurface } from "./components/ui/Content";
import { EntityMenu } from "./components/ui/EntityMenu";
import type { DocumentRequest } from "./DocumentWorkspace";
import { SpaceBodyPreview } from "./features/documents/SpaceBodyPreview";
import { KnowledgeGraph } from "./features/knowledge/KnowledgeGraph";
import { useDebouncedValue } from "./utils/use-debounced-value";
export function LibraryView({
  runtime,
  onOpen,
  snapshot,
  onChanged,
  onTrash,
  viewState,
  onViewChange,
}: {
  runtime: Runtime;
  onOpen: (request: DocumentRequest) => void;
  snapshot: Snapshot;
  onChanged(): Promise<void>;
  onTrash(): void;
  viewState: { spaceId: string | null; query: string };
  onViewChange(state: { spaceId: string | null; query: string }): void;
}) {
  const { t } = useTranslation("spaces");
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const selection = useEntitySelection();
  const [graphOpen, setGraphOpen] = useState(false);
  const entries = snapshot.library;
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const { spaceId, query } = viewState;
  const setSpaceId = (spaceId: string | null) =>
    onViewChange({ ...viewState, spaceId });
  const setQuery = (query: string) => onViewChange({ ...viewState, query });
  const [error, setError] = useState(false),
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
  const settledQuery = useDebouncedValue(query).toLocaleLowerCase();
  const [matches, setMatches] = useState<{
    query: string;
    spaceId: string;
    ids: ReadonlySet<string>;
  } | null>(null);
  useEffect(() => {
    if (!spaceId || !settledQuery) return;
    let current = true;
    setError(false);
    void runtime.searchLibrary(settledQuery, spaceId).then(
      (results) => {
        if (current)
          setMatches({
            query: settledQuery,
            spaceId,
            ids: new Set(results.map((result) => result.id)),
          });
      },
      () => {
        if (current) {
          setMatches(null);
          setError(true);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [runtime, spaceId, settledQuery, entries]);
  const documentCountBySpaceId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries)
      if (entry.kind === "DOCUMENT" && !entry.deletedAt && entry.spaceId)
        counts.set(entry.spaceId, (counts.get(entry.spaceId) ?? 0) + 1);
    return counts;
  }, [entries]);
  const docs = entries.filter(
    (e) =>
      e.kind === "DOCUMENT" &&
      !e.deletedAt &&
      e.spaceId === spaceId &&
      (!settledQuery ||
        (matches?.query === settledQuery &&
          matches.spaceId === spaceId &&
          matches.ids.has(e.id))),
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
        <Button
          type="button"
          variant="toggle"
          aria-pressed={graphOpen}
          onClick={() => setGraphOpen(!graphOpen)}
        >
          {zh ? "知识图谱" : "Knowledge graph"}
        </Button>

        <Button
          variant="secondary"
          type="button"
          onClick={() => setSpaceId(null)}
        >
          {t("back")}
        </Button>
        <Button variant="primary" type="button" onClick={() => open()}>
          <Plus size={16} />
          {t(space ? "newLecture" : "newSpace")}
        </Button>
      </div>
      {space ? (
        <>
          <section className="panel account-panel">
            <p className="eyebrow">{t("library")}</p>
            <h2>{space.title}</h2>
            <SpaceBodyPreview entry={space} runtime={runtime} />
            <div className="action-row">
              <Button
                variant="secondary"
                type="button"
                onClick={() => open(space)}
              >
                {t("edit")}
              </Button>
              <Button
                variant="secondary"
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
              </Button>
            </div>
          </section>
          <label className="field">
            {t("search")}
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <ListSurface className="library-list">
            {docs.map((doc) => (
              <ListRow
                className="library-document-row"
                key={doc.id}
                style={{ marginInlineStart: `${hierarchy(doc).length * 16}px` }}
                selected={selection?.selected?.id === doc.id}
                onSelect={() =>
                  selection?.select({ kind: "DOCUMENT", id: doc.id })
                }
                onOpen={() => open(doc)}
              >
                <BookOpen size={20} />
                <h3>{doc.title}</h3>
                {hierarchy(doc).length > 0 && (
                  <small>{hierarchy(doc).join(" / ")}</small>
                )}
                <small>
                  {new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: "medium",
                  }).format(new Date(doc.updatedAt))}
                </small>
                <EntityMenu
                  title={doc.title}
                  pending={busy}
                  onOpen={() => open(doc)}
                  onDelete={() =>
                    void run(async () => {
                      const deleted = await runtime.deleteLibrary(
                        doc.id,
                        doc.version,
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
                    })
                  }
                />
              </ListRow>
            ))}
          </ListSurface>
          {!docs.length && <p>{t("empty")}</p>}{" "}
        </>
      ) : (
        <>
          <p className="subtitle">{t("spaceHint")}</p>
          <ListSurface className="library-list">
            {spaces.map((item) => (
              <ListRow
                className="space-card"
                key={item.id}
                selected={selection?.selected?.id === item.id}
                onSelect={() =>
                  selection?.select({ kind: "DOCUMENT", id: item.id })
                }
                onOpen={() => setSpaceId(item.id)}
              >
                <BookOpen size={20} />
                <h2>{item.title}</h2>
                <footer>
                  {documentCountBySpaceId.get(item.id) ?? 0}{" "}
                  {t("documentCount")}
                </footer>
              </ListRow>
            ))}
          </ListSurface>
        </>
      )}
      <Button variant="ghost" type="button" onClick={onTrash}>
        {zh ? "查看回收站 →" : "View Trash →"}
      </Button>
    </div>
  );
}
