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
  const { t } = useTranslation("desk");
  const { t: a } = useTranslation("spaces");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [server, setServer] = useState(runtime.serverOrigin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(runtime.unavailable ? "loginNetwork" : "");
  const [saved, setSaved] = useState(() => runtime.savedAccounts());
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
              FORBIDDEN: "loginForbidden",
              RATE_LIMITED: "loginRateLimited",
              LOGIN_TIMEOUT: "loginTimeout",
              NETWORK_ERROR: "loginNetwork",
              INVALID_RESPONSE: "loginInvalidResponse",
              SERVER_CHANGED: "loginServerChanged",
              SECURE_STORAGE: "loginSecureStorage",
            };
            setError(messages[code] ?? "loginError");
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
            <p className="muted">{a("savedAccountsHint")}</p>
            {saved.map((item) => (
              <div className="token-row" key={item.id}>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    setServer(item.serverUrl);
                    setUsername(item.displayName);
                    setPassword("");
                    setError("");
                  }}
                >
                  {item.displayName}
                </button>
                <small>{item.serverUrl}</small>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  aria-label={a("forgetAccount") + " " + item.displayName}
                  onClick={() => {
                    try {
                      runtime.forgetAccount(item.id);
                      setSaved(runtime.savedAccounts());
                    } catch {
                      setError("loginError");
                    }
                  }}
                >
                  {a("forgetAccount")}
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
            {t(error)}
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
