import type { LibraryEntry } from "@arclattice/application";
import { BookOpen, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "./bootstrap";
import type { DocumentRequest } from "./DocumentWorkspace";
import { Markdown } from "./Markdown";
export function LibraryView({
  runtime,
  onOpen,
  onKnowledge,
}: {
  runtime: Runtime;
  onOpen: (request: DocumentRequest) => void;
  onKnowledge?: () => void;
}) {
  const { t } = useTranslation("spaces");
  const { t: desk } = useTranslation("desk");
  const [entries, setEntries] = useState<LibraryEntry[]>([]),
    [spaceId, setSpaceId] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void runtime
        .library()
        .then((data) => {
          if (alive) setEntries(data);
        })
        .catch(() => {
          if (alive) setError(true);
        });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [runtime]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await action();
      setEntries(await runtime.library());
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
  const hierarchy = (document: LibraryEntry) => {
    const ancestors: string[] = [];
    const visited = new Set([document.id]);
    let parentId = document.parentDocumentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = entries.find(
        (entry) =>
          entry.id === parentId &&
          !entry.deletedAt &&
          entry.spaceId === document.spaceId,
      );
      if (!parent) break;
      ancestors.unshift(parent.title);
      parentId = parent.parentDocumentId;
    }
    return ancestors;
  };
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
      <div className="library-toolbar action-row">
        {onKnowledge && (
          <button
            type="button"
            className="button secondary"
            onClick={onKnowledge}
          >
            {desk("knowledge")}
          </button>
        )}
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
                    await runtime.deleteLibrary(space.id, space.version, true);
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
      <details className="panel account-panel">
        <summary>{t("trash")}</summary>
        <p>{t("recoverHint")}</p>
        {entries
          .filter((e) => e.deletedAt)
          .map((e) => (
            <div className="token-row" key={e.id}>
              <span>{e.title}</span>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => runtime.deleteLibrary(e.id, e.version, false))
                }
              >
                {t("restore")}
              </button>
            </div>
          ))}
      </details>
    </div>
  );
}
