import type { AgentRun, ModelRoute } from "@arclattice/application";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiEdits } from "../../AiEdits";
import type { Runtime, Snapshot } from "../../bootstrap";
import { GatewayRunDetails } from "../../GatewaySettings";
import { Markdown } from "../../Markdown";
import { PersonalAISettings } from "../../PersonalAISettings";
export function AiSettingsView({
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
    routes: ModelRoute[];
    runs: AgentRun[];
  } | null>(null);
  const [profileId, setProfileId] = useState("default");
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
        const result = await runtime.ai(scope, profileId);
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
  }, [runtime, scope, profileId]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(false);
    try {
      await action();
      setData(await runtime.ai(scope, profileId));
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
            setProfileId("default");
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
      <label className="field">
        {zh ? "本次使用的模型配置" : "Model profile for this request"}
        <select
          value={profileId}
          disabled={busy}
          onChange={(e) => {
            setProfileId(e.target.value);
            setData(null);
          }}
        >
          <option value="default">{zh ? "默认配置" : "Default profile"}</option>
          {(data?.routes ?? [])
            .filter((route) => route.profileId && route.profileId !== "default")
            .map((route) => (
              <option key={route.profileId} value={route.profileId}>
                {route.profileId} · {route.model}
              </option>
            ))}
          {profileId !== "default" &&
            !data?.routes?.some((route) => route.profileId === profileId) && (
              <option value={profileId}>{profileId}</option>
            )}
        </select>
      </label>
      <PersonalAISettings
        key={scope + ":" + profileId}
        runtime={runtime}
        scope={scope}
        profileId={profileId}
        onProfileChange={(id) => {
          setProfileId(id);
          setData(null);
        }}
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
                  calls:
                    data.route.gateway?.dailyRequests ??
                    data.route.maxRunsPerDay,
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
                  profileId,
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
              <GatewayRunDetails run={run} zh={zh} />
              {run.attempt && (
                <p>
                  {t("attemptUsage", {
                    input: run.attempt.inputChars,
                    output: run.attempt.reservedOutputTokens,
                  })}{" "}
                  · {t("attempt" + run.attempt.outcome)}
                  {run.attempt.usage && (
                    <>
                      {" "}
                      ·{" "}
                      {t("reportedUsage", {
                        input: run.attempt.usage.inputTokens,
                        output: run.attempt.usage.outputTokens,
                      })}
                    </>
                  )}
                </p>
              )}
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
                        !(data.routes ?? (data.route ? [data.route] : [])).some(
                          (route) =>
                            route.fingerprint === run.route.fingerprint,
                        )
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
