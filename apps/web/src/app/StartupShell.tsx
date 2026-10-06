import { useTranslation } from "react-i18next";

/** Paint local chrome before session RTT; no private entity or assumed identity. */
export function StartupShell() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  return (
    <div className="startup-shell" data-testid="startup-shell" aria-busy="true">
      <aside className="startup-sidebar">
        <img
          className="brand-logo"
          src="/orivane-atlas.png"
          alt="Orivane Atlas"
        />
        <div className="startup-placeholder" />
        <div className="startup-placeholder" />
        <div className="startup-placeholder" />
      </aside>
      <main className="startup-main">
        <div className="startup-placeholder" />
        <p role="status">
          {zh ? "正在连接工作空间…" : "Connecting to your workspace…"}
        </p>
      </main>
    </div>
  );
}
