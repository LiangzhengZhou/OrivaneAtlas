import type { EntityRef, KnowledgeLink } from "@arclattice/application";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "./bootstrap";
import { Button } from "./components/ui/Button";
import { Select } from "./components/ui/Surfaces";
import { KnowledgeGraph } from "./features/knowledge/KnowledgeGraph";
import { Markdown } from "./Markdown";
import { useDebouncedValue } from "./utils/use-debounced-value";

const refKey = (ref: EntityRef) => ref.kind + ":" + ref.id;
export function KnowledgeView({
  runtime,
  snapshot,
  busy,
  onLink,
  onUnlink,
  onOpen,
}: {
  runtime: Runtime;
  snapshot: Snapshot;
  busy: boolean;
  onLink: (
    from: EntityRef,
    to: EntityRef,
    relation: KnowledgeLink["relation"],
  ) => Promise<boolean>;
  onUnlink: (link: KnowledgeLink) => Promise<boolean>;
  onOpen: (ref: EntityRef) => void;
}) {
  const { t } = useTranslation("connected");
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [target, setTarget] = useState("");
  const [relation, setRelation] =
    useState<KnowledgeLink["relation"]>("REFERENCES");
  const entities = useMemo(() => {
    const liveSpaces = new Set(
      snapshot.library
        .filter((entry) => entry.kind === "SPACE" && !entry.deletedAt)
        .map((entry) => entry.id),
    );
    return [
      ...snapshot.library
        .filter(
          (e) =>
            !e.deletedAt &&
            (e.kind === "SPACE" || liveSpaces.has(e.spaceId ?? "")),
        )
        .map((e) => ({
          ref: { kind: e.kind, id: e.id },
          title: e.title,
          body: e.bodyMd,
        })),
      ...snapshot.notes
        .filter((n) => !n.deletedAt)
        .map((n) => ({
          ref: { kind: "NOTE" as const, id: n.id },
          title: n.title,
          body: n.bodyMd,
        })),
      ...snapshot.items
        .filter((i) => !i.deletedAt)
        .map((i) => ({
          ref: { kind: "WORK" as const, id: i.id },
          title: i.title,
          body: i.descriptionMd,
        })),
    ].map((entry) => ({
      ...entry,
      searchText: (entry.title + "\n" + (entry.body ?? "")).toLocaleLowerCase(),
    }));
  }, [snapshot.library, snapshot.notes, snapshot.items]);
  const searchQuery = useDebouncedValue(query).trim().toLocaleLowerCase();
  const [matches, setMatches] = useState<{
    query: string;
    ids: ReadonlySet<string>;
  } | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  useEffect(() => {
    if (!searchQuery) return;
    let active = true;
    setSearchFailed(false);
    void Promise.all([
      runtime.searchNotes(searchQuery),
      runtime.searchLibrary(searchQuery, ""),
    ]).then(
      ([notes, documents]) => {
        if (active)
          setMatches({
            query: searchQuery,
            ids: new Set([
              ...notes.map((id) => "NOTE:" + id),
              ...documents.map((entry) => "DOCUMENT:" + entry.id),
            ]),
          });
      },
      () => {
        if (active) {
          setMatches(null);
          setSearchFailed(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [runtime, searchQuery, snapshot.notes, snapshot.library]);
  const current = entities.find((e) => refKey(e.ref) === selected);
  const links = snapshot.links.filter(
    (l) => refKey(l.from) === selected || refKey(l.to) === selected,
  );
  return (
    <>
      <KnowledgeGraph snapshot={snapshot} onOpen={onOpen} />
      <div className="connected-grid">
        <section className="connected-panel">
          <label className="field">
            {t("search")}
            <input
              aria-label={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchHint")}
            />
          </label>
          {searchFailed && <p role="alert">{t("desk:connectionError")}</p>}
          <div className="knowledge-list">
            {entities
              .filter(
                (e) =>
                  !searchQuery ||
                  e.searchText.includes(searchQuery) ||
                  (matches?.query === searchQuery &&
                    matches.ids.has(refKey(e.ref))),
              )
              .map((e) => (
                <Button
                  type="button"
                  className={
                    "knowledge-result " +
                    (refKey(e.ref) === selected ? "selected" : "")
                  }
                  key={refKey(e.ref)}
                  onClick={() => {
                    setSelected(refKey(e.ref));
                    setTarget("");
                  }}
                >
                  <small>{t(e.ref.kind)}</small>
                  <strong>{e.title}</strong>
                  {e.body !== undefined && <span>{e.body.slice(0, 120)}</span>}
                </Button>
              ))}
            {!entities.length && <p>{t("emptyKnowledge")}</p>}
          </div>
        </section>
        <section className="connected-panel">
          {current ? (
            <>
              <div className="connected-heading">
                <h2>{current.title}</h2>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onOpen(current.ref)}
                >
                  {t("open")}
                </Button>
              </div>
              <p>{t("referencesHint")}</p>
              <form
                className="link-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const destination = entities.find(
                    (e) => refKey(e.ref) === target,
                  );
                  if (destination)
                    void onLink(current.ref, destination.ref, relation).then(
                      (ok) => {
                        if (ok) setTarget("");
                      },
                    );
                }}
              >
                <label className="field">
                  {t("target")}
                  <Select
                    required
                    aria-label={t("target")}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">{t("choose")}</option>
                    {entities
                      .filter((e) => refKey(e.ref) !== selected)
                      .map((e) => (
                        <option key={refKey(e.ref)} value={refKey(e.ref)}>
                          {t(e.ref.kind)} · {e.title}
                        </option>
                      ))}
                  </Select>
                </label>
                <label className="field">
                  {t("relation")}
                  <Select
                    value={relation}
                    onChange={(e) =>
                      setRelation(e.target.value as KnowledgeLink["relation"])
                    }
                  >
                    <option value="REFERENCES">{t("REFERENCES")}</option>
                    <option value="RELATED">{t("RELATED")}</option>
                  </Select>
                </label>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={busy || !target}
                >
                  {t("addLink")}
                </Button>
              </form>
              <h3>{t("connections", { count: links.length })}</h3>
              {links.map((link) => {
                const outgoing = refKey(link.from) === selected;
                const other = entities.find(
                  (e) =>
                    refKey(e.ref) === refKey(outgoing ? link.to : link.from),
                );
                return (
                  other && (
                    <div className="knowledge-link" key={link.id}>
                      <Button
                        type="button"
                        onClick={() => {
                          setSelected(refKey(other.ref));
                          setTarget("");
                        }}
                      >
                        <small>
                          {t(
                            link.relation === "RELATED"
                              ? "RELATED"
                              : outgoing
                                ? "outgoing"
                                : "incoming",
                          )}
                        </small>
                        <strong>{other.title}</strong>
                      </Button>
                      <Button
                        variant="secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void onUnlink(link)}
                      >
                        {t("unlink")}
                      </Button>
                    </div>
                  )
                );
              })}
              {!links.length && <p>{t("noLinks")}</p>}
              {current.body !== undefined && (
                <details className="knowledge-preview">
                  <summary>{t("content")}</summary>
                  <Markdown text={current.body} />
                </details>
              )}
            </>
          ) : (
            <div className="connected-empty">
              <h2>{t("selectObject")}</h2>
              <p>{t("knowledgePrivacy")}</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
