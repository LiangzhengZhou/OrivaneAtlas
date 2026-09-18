import type {
  PersonalModelInput,
  PersonalModelSummary,
} from "@arclattice/application";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "./bootstrap";
import { GatewaySettings } from "./GatewaySettings";
export function PersonalAISettings({
  runtime,
  scope,
  profileId,
  onProfileChange,
  onChange,
}: {
  runtime: Runtime;
  scope: string;
  profileId: string;
  onProfileChange: (profileId: string) => void;
  onChange: () => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [nextProfile, setNextProfile] = useState(profileId);
  const [gateway, setGateway] = useState<PersonalModelInput["gateway"]>();
  const [profiles, setProfiles] = useState<string[]>([]);
  const [saved, setSaved] = useState<PersonalModelSummary | null>(null),
    [endpoint, setEndpoint] = useState(""),
    [model, setModel] = useState(""),
    [key, setKey] = useState(""),
    [protocol, setProtocol] = useState<"chat" | "responses">("chat"),
    [cap, setCap] = useState(10),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setKey("");
    setBusy(true);
    runtime
      .providers()
      .then((list) => {
        if (!active) return;
        setProfiles(
          list
            .filter(
              (item) =>
                item.scope === scope &&
                (item.profileId ?? "default") !== profileId,
            )
            .map((item) => item.profileId ?? "default"),
        );
        const item =
          list.find(
            (p) =>
              p.scope === scope && (p.profileId ?? "default") === profileId,
          ) ?? null;
        setSaved(item);
        setEndpoint(item?.endpoint ?? "");
        setModel(item?.model ?? "");
        setProtocol(item?.protocol ?? "chat");
        setCap(item?.maxRunsPerDay ?? 10);
        setGateway(item?.gateway);
      })
      .catch(() => {
        if (active) setError("UNAVAILABLE");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [runtime, scope, profileId]);
  return (
    <details className="connected-panel personal-ai-settings">
      <summary>{zh ? "我的 AI 接入配置" : "My AI connection"}</summary>
      <p>
        {zh
          ? "配置只属于当前用户及所选项目，不使用管理员全局配置。密钥在服务器独立加密保存，不返回浏览器；移除配置可停止后续调用。"
          : "Configuration belongs only to you and the selected project. No administrator defaults. Keys are encrypted separately on the server and never returned to the browser."}
      </p>
      <div className="field">
        <label htmlFor="ai-profile-id">
          {zh
            ? "配置标识（字母、数字、下划线、短横线）"
            : "Profile ID (letters, numbers, underscore, hyphen)"}
        </label>
        <input
          id="ai-profile-id"
          value={nextProfile}
          maxLength={64}
          disabled={busy}
          onChange={(e) => setNextProfile(e.target.value)}
        />
        <button
          className="button secondary"
          type="button"
          disabled={
            busy ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(nextProfile) ||
            nextProfile === profileId
          }
          onClick={() => onProfileChange(nextProfile)}
        >
          {zh ? "打开 / 新建配置" : "Open / create profile"}
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void runtime
            .saveProvider(saved?.version ?? 0, {
              scope,
              profileId,
              endpoint,
              model,
              key,
              protocol,
              maxRunsPerDay: cap,
              ...(gateway ? { gateway } : {}),
            })
            .then((value) => {
              setSaved(value);
              setKey("");
              onChange();
            })
            .catch((cause) => setError(cause.code ?? "UNAVAILABLE"))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          {zh ? "HTTPS API 基址" : "HTTPS API base URL"}
          <input
            type="url"
            required
            value={endpoint}
            disabled={busy}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://provider.example/v1"
          />
        </label>
        <label className="field">
          {zh ? "协议" : "Protocol"}
          <select
            value={protocol}
            disabled={busy}
            onChange={(e) =>
              setProtocol(e.target.value as "chat" | "responses")
            }
          >
            <option value="chat">Chat Completions</option>
            <option value="responses">Responses</option>
          </select>
        </label>
        <label className="field">
          {zh ? "模型标识" : "Model identifier"}
          <input
            value={model}
            required
            disabled={busy}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label className="field">
          {zh
            ? "API 密钥（留空保留已有密钥）"
            : "API key (blank keeps existing key)"}
          <input
            type="password"
            autoComplete="new-password"
            required={!saved}
            disabled={busy}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label className="field">
          {zh
            ? "每日最多调用次数（非金额预算）"
            : "Daily call limit (not a spending budget)"}
          <input
            type="number"
            min={1}
            max={100}
            value={cap}
            disabled={busy}
            onChange={(e) => setCap(Number(e.target.value))}
          />
        </label>
        <GatewaySettings
          value={gateway}
          onChange={setGateway}
          disabled={busy}
          zh={zh}
          profiles={profiles}
        />
        <button className="button primary" disabled={busy}>
          {zh ? "保存个人配置" : "Save personal configuration"}
        </button>
        {saved && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  zh
                    ? "移除此个人 AI 配置？"
                    : "Remove this personal AI configuration?",
                )
              )
                return;
              setBusy(true);
              void runtime
                .removeProvider(scope, saved.version, profileId)
                .then(() => {
                  setSaved(null);
                  setKey("");
                  onChange();
                })
                .catch((cause) => setError(cause.code ?? "UNAVAILABLE"))
                .finally(() => setBusy(false));
            }}
          >
            {zh ? "移除配置" : "Remove configuration"}
          </button>
        )}
        {saved && (
          <p role="status">
            {zh ? "已保存，密钥不回显" : "Saved; key remains hidden"} · v
            {saved.version}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error} ·{" "}
            {zh
              ? "请检查配置或重新加载后重试。"
              : "Check settings or reload before retrying."}
          </p>
        )}
      </form>
    </details>
  );
}
