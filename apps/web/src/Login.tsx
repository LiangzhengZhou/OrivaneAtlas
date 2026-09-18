import { ArrowRight, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "./bootstrap";
export function Login({
  runtime,
  onLogin,
}: {
  runtime: Runtime;
  onLogin: () => void;
}) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const { t: a } = useTranslation("spaces");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [server, setServer] = useState(runtime.serverOrigin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(runtime.unavailable ? "loginNetwork" : "");
  const [saved, setSaved] = useState(() => runtime.savedAccounts());
  const forgetLabel = runtime.native
    ? a("forgetSecureAccount", {
        defaultValue: zh ? "忘记账户" : "Forget account",
      })
    : a("forgetAccount");
  function showLoginError(cause: unknown) {
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : cause instanceof Error
          ? cause.message
          : String(cause);
    const messages: Record<string, string> = {
      INVALID_SERVER: "loginInvalidServer",
      VALIDATION_ERROR: "loginInvalidInput",
      UNAUTHORIZED: "loginCredentials",
      ACCOUNT_MISMATCH: "loginCredentials",
      FORBIDDEN: "loginForbidden",
      RATE_LIMITED: "loginRateLimited",
      LOGIN_TIMEOUT: "loginTimeout",
      NETWORK_ERROR: "loginNetwork",
      INVALID_RESPONSE: "loginInvalidResponse",
      SERVER_CHANGED: "loginServerChanged",
      SECURE_STORAGE: "loginSecureStorage",
      VAULT_FULL: "loginVaultFull",
    };
    setError(messages[code] ?? "loginError");
  }
  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand">
          <img
            className="brand-logo"
            src="/orivane-atlas.png"
            alt="Orivane Atlas"
          />
        </div>
        <h1>{t("welcome")}</h1>
        <p>{t("dataControl")}</p>
      </section>
      <form
        className="login-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await runtime.setServerOrigin(server);
            const context = await runtime.session({
              username: username.trim(),
              password,
            });
            runtime.context = context;
            setPassword("");
            onLogin();
          } catch (cause) {
            showLoginError(cause);
          } finally {
            setBusy(false);
          }
        }}
        aria-busy={busy}
      >
        <LockKeyhole size={28} />
        <h2>{a("login")}</h2>
        {runtime.logoutWarning && (
          <p role="alert" className="error">
            {a("localLogoutOnly")}
          </p>
        )}
        {saved.length > 0 && (
          <section aria-label={a("savedAccounts")}>
            <p className="muted">
              {runtime.native
                ? a("secureAccountsHint", {
                    defaultValue: zh
                      ? "选择已保存的账户可直接切换；会话过期后需重新登录。忘记账户仅删除本机凭据。"
                      : "Select a saved account to switch. Expired sessions require sign-in. Forget removes only the credential on this device.",
                  })
                : a("savedAccountsHint")}
            </p>
            {saved.map((item) => (
              <div
                className="token-row"
                key={item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr)",
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    setServer(item.serverUrl);
                    setUsername(item.displayName);
                    setPassword("");
                    setError("");
                    if (runtime.native) {
                      setBusy(true);
                      try {
                        await runtime.switchAccount(item.id);
                        onLogin();
                      } catch (cause) {
                        showLoginError(cause);
                        setSaved(runtime.savedAccounts());
                      } finally {
                        setBusy(false);
                      }
                    }
                  }}
                >
                  {item.displayName}
                </button>
                <small>{item.serverUrl}</small>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  aria-label={forgetLabel + " " + item.displayName}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      await runtime.forgetAccount(item.id);
                      setSaved(runtime.savedAccounts());
                    } catch {
                      setError("loginError");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {forgetLabel}
                </button>
              </div>
            ))}
          </section>
        )}
        <label className="field">
          <span>{a("server")}</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="url"
            required
            placeholder="https://your-server.example"
            value={server}
            disabled={busy}
            onChange={(event) => setServer(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{a("username")}</span>
          <input
            autoComplete="username"
            required
            value={username}
            disabled={busy}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={32}
          />
        </label>
        <label className="field">
          <span>{a("password")}</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
            value={password}
            maxLength={128}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error === "loginVaultFull"
              ? t(error, {
                  defaultValue: zh
                    ? "最多保存 20 个账户，请先忘记不再使用的账户。"
                    : "Up to 20 accounts can be saved. Forget an unused account first.",
                })
              : t(error)}
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !server.trim() || !username.trim() || !password}
          type="submit"
        >
          {busy ? t("connecting") : t("enter")}
          <ArrowRight size={17} />
        </button>
        {busy && <p role="status">{t("loginDeadline")}</p>}
      </form>
    </main>
  );
}
