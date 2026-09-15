import type { Account, ApiCredential } from "@arclattice/application";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "./bootstrap";

export function AccountView({
  runtime,
  onLogout,
}: {
  runtime: Runtime;
  onLogout: () => void;
}) {
  const { t, i18n } = useTranslation("spaces");
  const zh = i18n.language.startsWith("zh");
  const [days, setDays] = useState<30 | 90 | 365 | null>(30);
  const [tokens, setTokens] = useState<ApiCredential[]>([]),
    [name, setName] = useState("");
  const [scope, setScope] = useState<ApiCredential["scope"]>("write"),
    [secret, setSecret] = useState("");
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (runtime.account)
      void runtime
        .tokens()
        .then(setTokens)
        .catch(() => setError(true));
  }, [runtime]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-grid">
      {error && (
        <p className="error" role="alert">
          {t("error")}
        </p>
      )}
      {notice && <p role="status">{t(notice)}</p>}
      {!runtime.account ? (
        <section className="panel account-panel">
          <h2>{t("claim")}</h2>
          <p>{t("claimHint")}</p>
          <p className="muted">{t("signInHint")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await runtime.claim(username, password);
                setPassword("");
                setNotice("claimed");
              });
            }}
          >
            <label className="field">
              {t("username")}
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="field">
              {t("password")}
              <input
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy || !!notice}>
              {t("claim")}
            </button>
          </form>
        </section>
      ) : (
        <section className="panel account-panel">
          <h2>{runtime.account.username}</h2>
          <p>{t(runtime.account.role)}</p>
          <h3>{t("passwordChange")}</h3>
          <p className="muted">{t("passwordHint")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await runtime.changePassword(current, password);
                setCurrent("");
                setPassword("");
                onLogout();
              });
            }}
          >
            <label className="field">
              {t("currentPassword")}
              <input
                type="password"
                required
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label className="field">
              {t("newPassword")}
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="button secondary" disabled={busy}>
              {t("passwordChange")}
            </button>
          </form>
        </section>
      )}
      <section className="panel account-panel">
        <h2>{t("tokens")}</h2>
        <p>{t("tokenHint")}</p>
        <p className="muted">{t("apiExample")}</p>
        <a
          className="button secondary"
          href="/api/openapi.json"
          download="arclattice-openapi.json"
        >
          {t("apiSpec")}
        </a>
        {!runtime.account ? (
          <p>{t("bindFirst")}</p>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await runtime.issueToken(name, scope, days);
                  setSecret(result.secret);
                  setTokens(await runtime.tokens());
                });
              }}
            >
              <label className="field">
                {t("tokenName")}
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                {t("scope", { defaultValue: t("tokens") })}
                <select
                  value={scope}
                  onChange={(e) =>
                    setScope(e.target.value as ApiCredential["scope"])
                  }
                >
                  <option value="write">{t("write")}</option>
                  <option value="read-write">{t("readWrite")}</option>
                </select>
              </label>
              <label className="field">
                {zh ? "有效期" : "Validity"}
                <select
                  value={days ?? "permanent"}
                  onChange={(e) =>
                    setDays(
                      e.target.value === "permanent"
                        ? null
                        : (Number(e.target.value) as 30 | 90 | 365),
                    )
                  }
                >
                  {[30, 90, 365].map((n) => (
                    <option key={n} value={n}>
                      {n} {zh ? "天" : "days"}
                    </option>
                  ))}
                  <option value="permanent">
                    {zh ? "长期有效（可撤销）" : "Permanent (revocable)"}
                  </option>
                </select>
              </label>
              <p className="muted">{t("readWarning")}</p>
              <button className="button primary" disabled={busy || !!secret}>
                {t("issue")}
              </button>
            </form>
            {secret && (
              <div className="secret-once">
                <p>{t("once")}</p>
                <textarea
                  readOnly
                  value={secret}
                  aria-label={t("tokens")}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setSecret("")}
                >
                  {t("closeSecret")}
                </button>
              </div>
            )}
            <div className="token-list">
              {tokens.map((item) => (
                <div className="token-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {t(item.scope === "write" ? "write" : "readWrite")} ·{" "}
                      {t("expires")}{" "}
                      {item.expiresAt?.slice(0, 10) ??
                        (zh ? "长期有效" : "Permanent")}
                    </small>
                  </div>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy || !!item.revokedAt}
                    onClick={() =>
                      void run(async () => {
                        await runtime.revokeToken(item.id);
                        setTokens(await runtime.tokens());
                      })
                    }
                  >
                    {t(item.revokedAt ? "revoked" : "revoke")}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
export function AdminView({ runtime }: { runtime: Runtime }) {
  const { t } = useTranslation("spaces");
  const [accounts, setAccounts] = useState<Account[]>([]),
    [bytes, setBytes] = useState(0),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const data = await runtime.admin();
    setAccounts(data.accounts);
    setBytes(data.databaseBytes);
  }
  useEffect(() => {
    void runtime
      .admin()
      .then((data) => {
        setAccounts(data.accounts);
        setBytes(data.databaseBytes);
      })
      .catch(() => setError(true));
  }, [runtime]);
  return (
    <>
      <div className="metric-grid">
        {[
          ["accounts", accounts.length],
          ["active", accounts.filter((a) => a.status === "ACTIVE").length],
          ["waiting", accounts.filter((a) => a.status === "PENDING").length],
          ["database", (bytes / 1048576).toFixed(1) + " MB"],
        ].map(([key, value]) => (
          <div className="metric-card" key={key}>
            <span>{t(String(key))}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {t("error")}
        </p>
      )}
      <section className="panel account-panel">
        <div className="panel-heading">
          <h2>{t("accounts")}</h2>
          <button
            type="button"
            className="button secondary"
            onClick={() => void refresh().catch(() => setError(true))}
          >
            {t("refresh")}
          </button>
        </div>
        {accounts.length === 0 && <p>{t("empty")}</p>}
        {accounts.map((account) => (
          <div className="token-row" key={account.id}>
            <div>
              <strong>{account.username}</strong>
              <small>
                {t(account.role)} · {t(account.status)}
              </small>
            </div>
            {account.role !== "ADMIN" && (
              <div className="action-row">
                {(["ACTIVE", "DISABLED"] as const).map((status) => (
                  <button
                    type="button"
                    className="button secondary"
                    key={status}
                    disabled={busy || account.status === status}
                    onClick={() => {
                      setBusy(true);
                      setError(false);
                      void runtime
                        .accountStatus(account.id, account.version, status)
                        .then(refresh)
                        .catch(() => setError(true))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t(status === "ACTIVE" ? "approve" : "disable")}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
