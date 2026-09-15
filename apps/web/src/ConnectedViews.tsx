import type {
  AgentRun,
  EntityRef,
  KnowledgeLink,
  ModelRoute,
} from "@arclattice/application";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiEdits } from "./AiEdits";
import type { Runtime, Snapshot } from "./bootstrap";
import { GraphCanvas } from "./GraphCanvas";
import { Markdown } from "./Markdown";
import { PersonalAISettings } from "./PersonalAISettings";

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
      <GraphCanvas
        snapshot={snapshot}
        onOpen={onOpen}
        onConnect={onLink}
        onRemove={(id) => {
          const link = snapshot.links.find((l) => l.id === id);
          return link ? onUnlink(link) : Promise.resolve(false);
        }}
      />
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

export function AiView({
  runtime,
  snapshot,
}: {
  runtime: Runtime;
  snapshot: Snapshot;
}) {
  const { t, i18n } = useTranslation("connected");
  const zh = i18n.language.startsWith("zh");
  const [scope, setScope] = useState("personal");
  const [sources, setSources] = useState<string[]>([]);
  const contextOptions = [
    ...snapshot.notes
      .filter((e) => !e.deletedAt)
      .map((e) => ({ ...e, refKind: "NOTE" as const })),
    ...snapshot.library
      .filter(
        (e) =>
          !e.deletedAt &&
          (e.kind === "SPACE" ||
            snapshot.library.some((p) => p.id === e.spaceId && !p.deletedAt)),
      )
      .map((e) => ({ ...e, refKind: e.kind })),
  ].filter(
    (e) =>
      !scope.startsWith("SPACE:") ||
      e.id === scope.slice(6) ||
      ("spaceId" in e && e.spaceId === scope.slice(6)),
  );
  const [data, setData] = useState<{
    route: ModelRoute | null;
    runs: AgentRun[];
  } | null>(null);
  const [prompt, setPrompt] = useState(""),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true,
      pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await runtime.ai(scope);
        if (active) setData(result);
      } catch {
        if (active) setError(true);
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [runtime, scope]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(false);
    try {
      await action();
      setData(await runtime.ai(scope));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <label className="field">
        {zh ? "AI 配置所属项目 / 空间" : "AI project / space"}
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setData(null);
            setSources([]);
            setPrompt("");
          }}
          disabled={busy}
        >
          <option value="personal">
            {zh ? "个人工作区" : "Personal workspace"}
          </option>
          {snapshot.items
            .filter((i) => i.type === "PROJECT" && !i.deletedAt)
            .map((i) => (
              <option key={i.id} value={"WORK:" + i.id}>
                {i.title}
              </option>
            ))}
          {snapshot.library
            .filter((e) => e.kind === "SPACE" && !e.deletedAt)
            .map((e) => (
              <option key={e.id} value={"SPACE:" + e.id}>
                {e.title}
              </option>
            ))}
        </select>
      </label>
      <PersonalAISettings
        key={scope}
        runtime={runtime}
        scope={scope}
        onChange={() => void act(async () => {})}
      />
      <div className="connected-grid ai-layout">
        <section className="connected-panel">
          <h2>{t("newRun")}</h2>
          <p>{t("aiPrivacy")}</p>
          {!data ? (
            <p>{t("loading")}</p>
          ) : !data.route ? (
            <div className="connected-notice">{t("unconfigured")}</div>
          ) : (
            <div className="connected-notice">
              <strong>{data.route.model}</strong>
              <div>{data.route.provider}</div>
              <small>
                {t("limits", {
                  input: data.route.maxInputChars,
                  output: data.route.maxOutputTokens,
                  calls: data.route.maxRunsPerDay,
                })}
              </small>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await runtime.propose(
                  prompt,
                  scope,
                  contextOptions
                    .filter((e) => sources.includes(e.refKind + ":" + e.id))
                    .map((e) => ({
                      kind: e.refKind,
                      id: e.id,
                      version: e.version,
                    })),
                );
                setPrompt("");
                setSources([]);
              });
            }}
          >
            <label className="field">
              {t("prompt")}
              <textarea
                rows={10}
                aria-label={t("prompt")}
                value={prompt}
                maxLength={data?.route?.maxInputChars ?? 32000}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t("promptHint")}
                required
              />
            </label>
            <details>
              <summary>
                {zh
                  ? "选择本次允许 AI 读取的文档（默认不选）"
                  : "Select documents for this request (none by default)"}
              </summary>
              <p>
                {zh
                  ? "这些正文会出现在下一步审批预览中；批准后才会发给所选提供商。最多20份，总输入最多32000字符。"
                  : "These texts appear in the approval preview and are sent only after approval. Maximum 20 documents and 32,000 input characters."}
              </p>
              {contextOptions.map((e) => (
                <label className="field" key={e.refKind + e.id}>
                  <span>
                    <input
                      type="checkbox"
                      checked={sources.includes(e.refKind + ":" + e.id)}
                      onChange={(event) =>
                        setSources((old) =>
                          event.target.checked
                            ? [...old, e.refKind + ":" + e.id]
                            : old.filter((id) => id !== e.refKind + ":" + e.id),
                        )
                      }
                    />
                    {e.title} · v{e.version}
                  </span>
                </label>
              ))}
            </details>
            <button
              type="submit"
              className="button primary"
              disabled={busy || !data?.route || !prompt.trim()}
            >
              {t("propose")}
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {t("aiError")}
            </p>
          )}
        </section>
        <section className="connected-panel">
          <h2>{t("runHistory")}</h2>
          <p>{t("historyHint")}</p>
          {data?.runs.length === 0 && <p>{t("noRuns")}</p>}
          {data?.runs.map((run) => (
            <article className="ai-run" key={run.id}>
              <div className="connected-heading">
                <strong>{t(run.status)}</strong>
                <small>{new Date(run.createdAt).toLocaleString()}</small>
              </div>
              <p className="run-route">
                {run.route.model} · {run.route.provider}
              </p>
              <pre className="run-prompt">{run.prompt}</pre>
              {run.status === "WAITING_APPROVAL" && (
                <>
                  <p>
                    {t("approvalHint", { output: run.route.maxOutputTokens })}
                  </p>
                  <div className="connected-heading">
                    <button
                      type="button"
                      className="button primary"
                      disabled={
                        busy ||
                        !data.route ||
                        data.route.fingerprint !== run.route.fingerprint
                      }
                      onClick={() =>
                        void act(() =>
                          runtime.decide(run.id, run.version, true),
                        )
                      }
                    >
                      {t("approve")}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          runtime.decide(run.id, run.version, false),
                        )
                      }
                    >
                      {t("reject")}
                    </button>
                  </div>
                </>
              )}
              {run.output && <Markdown text={run.output} />}
              <AiEdits
                run={run}
                busy={busy}
                onApply={(indices) =>
                  void act(() => runtime.applyAi(run.id, run.version, indices))
                }
              />
              {run.error && <p className="error">{t("runFailed")}</p>}
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
