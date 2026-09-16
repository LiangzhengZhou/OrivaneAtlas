import type {
  AppUpdateInfo,
  AppUpdateProgress,
  AppUpdates,
} from "@arclattice/application";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function AppUpdater({ updates }: { updates: AppUpdates }) {
  const { t } = useTranslation("settings");
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [state, setState] = useState("idle");
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const busy = useRef(false);
  if (!updates.available) return null;
  async function check() {
    if (busy.current) return;
    busy.current = true;
    setState("checking");
    setInfo(null);
    try {
      const result = await updates.check();
      setInfo(result);
      setState(result.version ? "ready" : "current");
    } catch {
      setState("error");
    } finally {
      busy.current = false;
    }
  }
  async function install() {
    if (busy.current || !info?.version || !window.confirm(t("updateConfirm")))
      return;
    busy.current = true;
    setState("installing");
    setProgress(null);
    try {
      await updates.install(info.version, setProgress);
      setState("installer");
    } catch {
      setState("error");
    } finally {
      busy.current = false;
    }
  }
  const working = state === "checking" || state === "installing";
  return (
    <section className="card app-updater" aria-label={t("updateTitle")}>
      <h2>{t("updateTitle")}</h2>
      <p>{t("updateHint")}</p>
      {info && (
        <p>
          {t("updateVersions", {
            current: info.currentVersion,
            target: info.version ?? info.currentVersion,
          })}
        </p>
      )}
      <p role="status">{t("updateState_" + state)}</p>
      {state === "installing" && (
        <progress
          aria-label={t("updateProgress")}
          value={progress?.total ? progress.downloaded : undefined}
          max={progress?.total || 1}
        />
      )}
      {info?.notes && (
        <details>
          <summary>{t("updateNotes")}</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {info.notes}
          </pre>
        </details>
      )}
      <button type="button" disabled={working} onClick={check}>
        {t("updateCheck")}
      </button>
      {info?.version && (
        <button type="button" disabled={working} onClick={install}>
          {t("updateInstall")}
        </button>
      )}
    </section>
  );
}
