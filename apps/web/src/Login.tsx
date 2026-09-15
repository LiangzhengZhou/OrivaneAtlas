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
  const [error, setError] = useState(runtime.unavailable);
  return (
    <main className="login-shell">
      <form
        className="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(false);
          void runtime
            .setServerOrigin(server)
            .then(() => runtime.session({ username, password }))
            .then((context) => {
              runtime.context = context;
              setPassword("");
              onLogin();
            })
            .catch(() => setError(true))
            .finally(() => setBusy(false));
        }}
      >
        <LockKeyhole size={28} />
        <h2>{a("login")}</h2>
        <label className="field">
          <span>{a("server")}</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="url"
            required
            placeholder="https://your-server.example"
            value={server}
            onChange={(event) => setServer(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{a("username")}</span>
          <input
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={32}
          />
        </label>
        <label className="field">
          <span>{a("password")}</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {t("loginError")}
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !server.trim() || !username.trim() || !password}
          type="submit"
        >
          {busy
            ? t("connecting")
            : t("enter")}
          <ArrowRight size={17} />
        </button>
      </form>
    </main>
  );
}
