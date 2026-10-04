import type {
  AgentRun,
  ModelConfiguration,
  ModelRoute,
} from "@arclattice/application";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiEdits } from "../../AiEdits";
import type { Runtime, Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Surfaces";
import { GatewayRunDetails } from "../../GatewaySettings";
import { Markdown } from "../../Markdown";
import { ModelSettings } from "./ModelSettings";

export function AiSettingsView({
  runtime,
  snapshot,
}: {
  runtime: Runtime;
  snapshot: Snapshot;
}) {
  const { t, i18n } = useTranslation("connected");
  const zh = i18n.language.startsWith("zh");
  const [configuration, setConfiguration] = useState<ModelConfiguration | null>(
      null,
    ),
    [activityOpen, setActivityOpen] = useState(false),
    [testingOpen, setTestingOpen] = useState(false),
    [refreshVersion, setRefreshVersion] = useState(0);
  const [profileId, setProfileId] = useState("default"),
    [prompt, setPrompt] = useState(""),
    [sources, setSources] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [data, setData] = useState<{
    route: ModelRoute | null;
    routes: ModelRoute[];
    runs: AgentRun[];
  } | null>(null);
  useEffect(() => {
    if (!activityOpen && !testingOpen) return;
    let active = true;
    const load = async () => {
      try {
        const data = await runtime.ai("personal", profileId, activityOpen);
        if (active) setData(data);
      } catch (failure) {
        if (active)
          setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
      }
    };
    void load();
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [runtime, profileId, activityOpen, testingOpen, refreshVersion]);
  useEffect(() => {
    if (!activityOpen) return;
    const running = data?.runs.find((run) => run.status === "RUNNING");
    if (!running) return;
    const controller = new AbortController();
    void runtime
      .streamAiEvents(running.id, controller.signal, () => {})
      .then(() => {
        if (!controller.signal.aborted) setRefreshVersion((value) => value + 1);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "ACTIVITY_STREAM_FAILED",
          );
      });
    return () => controller.abort();
  }, [
    runtime,
    activityOpen,
    data?.runs.find((run) => run.status === "RUNNING")?.id,
  ]);
  const contextOptions = useMemo(() => {
    const spaces = new Set(
      snapshot.library
        .filter((entry) => entry.kind === "SPACE" && !entry.deletedAt)
        .map((entry) => entry.id),
    );
    return [
      ...snapshot.notes
        .filter((entry) => !entry.deletedAt)
        .map((entry) => ({ ...entry, refKind: "NOTE" as const })),
      ...snapshot.library
        .filter(
          (entry) =>
            !entry.deletedAt &&
            (entry.kind === "SPACE" || spaces.has(entry.spaceId ?? "")),
        )
        .map((entry) => ({ ...entry, refKind: entry.kind })),
    ];
  }, [snapshot.notes, snapshot.library]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setRefreshVersion((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "OPERATION_FAILED");
    } finally {
      setBusy(false);
    }
  }
  const today = new Date().toISOString().slice(0, 10),
    todayRuns = (data?.runs ?? []).filter(
      (run) => run.approvedAt?.slice(0, 10) === today,
    );
  const charged = todayRuns.reduce(
    (total, run) => total + (run.attempt?.money?.chargedMicros ?? 0),
    0,
  );
  return (
    <>
      <ModelSettings
        runtime={runtime}
        snapshot={snapshot}
        onConfiguration={setConfiguration}
        onChanged={() => setRefreshVersion((value) => value + 1)}
      />
      <details
        className="model-settings-section ai-activity"
        open={activityOpen}
      >
        <summary
          onClick={(event) => {
            event.preventDefault();
            setActivityOpen(!activityOpen);
          }}
        >
          {zh ? "用量与预算 / Activity" : "Usage & Budget / Activity"}
        </summary>
        {activityOpen && (
          <>
            <p>
              {zh ? "今日（UTC）已批准请求" : "Approved requests today (UTC)"}:{" "}
              {todayRuns.length} · {zh ? "已记账费用" : "Recorded charges"}: $
              {(charged / 1_000_000).toFixed(4)}
            </p>
            <p>
              {zh
                ? "显示最近 100 次请求；用量可能未知，精确配额与预算由服务器事务校验。"
                : "Shows the latest 100 requests; usage may be unknown. The server enforces exact limits and budgets transactionally."}
            </p>
            <Button
              type="button"
              disabled={busy}
              onClick={() => setRefreshVersion((value) => value + 1)}
            >
              {zh ? "刷新活动" : "Refresh activity"}
            </Button>
            {data?.runs.length === 0 && <p>{t("noRuns")}</p>}
            {data?.runs.map((run) => (
              <article className="ai-run" key={run.id}>
                <div className="connected-heading">
                  <strong>{t(run.status)}</strong>
                  <small>
                    {new Date(run.createdAt).toLocaleString(i18n.language)}
                  </small>
                </div>
                <p className="run-route">
                  {run.route.model} · {run.route.provider}
                </p>
                <pre className="run-prompt">{run.prompt}</pre>
                <GatewayRunDetails run={run} zh={zh} />
                {run.status === "WAITING_APPROVAL" && (
                  <div className="action-row">
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          runtime.decide(run.id, run.version, true),
                        )
                      }
                    >
                      {t("approve")}
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          runtime.decide(run.id, run.version, false),
                        )
                      }
                    >
                      {t("reject")}
                    </Button>
                  </div>
                )}
                {run.output && <Markdown text={run.output} />}
                <AiEdits
                  run={run}
                  busy={busy}
                  onApply={(indices) =>
                    void act(() =>
                      runtime.applyAi(run.id, run.version, indices),
                    )
                  }
                />
                {run.error && (
                  <p role="alert">
                    {t("runFailed")} {run.error}
                  </p>
                )}
              </article>
            ))}
          </>
        )}
      </details>
      <details className="model-settings-section" open={testingOpen}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            setTestingOpen(!testingOpen);
          }}
        >
          {t("newRun")}
        </summary>
        {testingOpen && (
          <>
            <label>
              {zh ? "本次使用的模型配置" : "Model profile for this request"}
              <Select
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
              >
                <option value="default">
                  {zh ? "默认配置" : "Default profile"}
                </option>
                {configuration?.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </Select>
            </label>
            <div className="connected-notice">
              {data?.route ? (
                <>
                  <strong>{data.route.model}</strong>
                  <p>{data.route.provider}</p>
                </>
              ) : (
                <p>
                  {zh
                    ? "请先设置默认模型或选择配置。"
                    : "Set a default model or choose a profile first."}
                </p>
              )}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  await runtime.propose(
                    prompt,
                    "personal",
                    contextOptions
                      .filter((entry) =>
                        sources.includes(`${entry.refKind}:${entry.id}`),
                      )
                      .map((entry) => ({
                        kind: entry.refKind,
                        id: entry.id,
                        version: entry.version,
                      })),
                    profileId,
                  );
                  setPrompt("");
                  setSources([]);
                  setActivityOpen(true);
                });
              }}
            >
              <label className="field">
                {t("prompt")}
                <textarea
                  aria-label={t("prompt")}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  maxLength={data?.route?.maxInputChars ?? 32000}
                  required
                />
              </label>
              <details>
                <summary>
                  {zh
                    ? "选择本次允许读取的文档"
                    : "Choose documents for this request"}
                </summary>
                {contextOptions.map((entry) => (
                  <label key={`${entry.refKind}:${entry.id}`}>
                    <input
                      type="checkbox"
                      checked={sources.includes(`${entry.refKind}:${entry.id}`)}
                      disabled={
                        sources.length >= 20 &&
                        !sources.includes(`${entry.refKind}:${entry.id}`)
                      }
                      onChange={(event) =>
                        setSources((current) =>
                          event.target.checked
                            ? [...current, `${entry.refKind}:${entry.id}`]
                            : current.filter(
                                (id) => id !== `${entry.refKind}:${entry.id}`,
                              ),
                        )
                      }
                    />
                    {entry.title}
                  </label>
                ))}
              </details>
              <Button
                type="submit"
                disabled={busy || !data?.route || !prompt.trim()}
              >
                {t("propose")}
              </Button>
            </form>
          </>
        )}
      </details>
      {error && (
        <p role="alert">
          {t("aiError")} {error}
        </p>
      )}
    </>
  );
}
