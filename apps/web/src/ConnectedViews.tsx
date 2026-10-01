import type { EntityRef, KnowledgeLink } from "@arclattice/application";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "./bootstrap";
import { KnowledgeGraph } from "./features/knowledge/KnowledgeGraph";
import { Markdown } from "./Markdown";

const refKey = (ref: EntityRef) => ref.kind + ":" + ref.id;
export function KnowledgeView({
  snapshot,
  busy,
  onLink,
  onUnlink,
  onOpen,
}: {
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
  const entities = [
    ...snapshot.library
      .filter(
        (e) =>
          !e.deletedAt &&
          (e.kind === "SPACE" ||
            snapshot.library.some((p) => p.id === e.spaceId && !p.deletedAt)),
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
  ];
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
          <div className="knowledge-list">
            {entities
              .filter((e) =>
                (e.title + "\n" + e.body)
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((e) => (
                <button
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
                  <span>{e.body.slice(0, 120)}</span>
                </button>
              ))}
            {!entities.length && <p>{t("emptyKnowledge")}</p>}
          </div>
        </section>
        <section className="connected-panel">
          {current ? (
            <>
              <div className="connected-heading">
                <h2>{current.title}</h2>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onOpen(current.ref)}
                >
                  {t("open")}
                </button>
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
                  <select
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
                  </select>
                </label>
                <label className="field">
                  {t("relation")}
                  <select
                    value={relation}
                    onChange={(e) =>
                      setRelation(e.target.value as KnowledgeLink["relation"])
                    }
                  >
                    <option value="REFERENCES">{t("REFERENCES")}</option>
                    <option value="RELATED">{t("RELATED")}</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy || !target}
                >
                  {t("addLink")}
                </button>
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
                      <button
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
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void onUnlink(link)}
                      >
                        {t("unlink")}
                      </button>
                    </div>
                  )
                );
              })}
              {!links.length && <p>{t("noLinks")}</p>}
              <details className="knowledge-preview">
                <summary>{t("content")}</summary>
                <Markdown text={current.body} />
              </details>
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
