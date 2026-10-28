import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, ServerProbeResult } from "../bootstrap";
import { Button } from "../components/ui/Button";

const resultKey: Record<ServerProbeResult["kind"], string> = {
  OK: "connectionOk",
  AUTH_REQUIRED: "connectionAuthRequired",
  NETWORK_FAILURE: "connectionNetwork",
  TIMEOUT: "connectionTimeout",
  SERVER_ERROR: "connectionServerError",
  LOCAL_ONLY: "connectionLocalOnly",
};

export function ServerConnectionTest({ runtime }: { runtime: Runtime }) {
  const { t } = useTranslation("desk");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ServerProbeResult | null>(null);
  const { i18n } = useTranslation();
  async function probe() {
    if (busy) return;
    setBusy(true);
    try {
      setResult(await runtime.probeServer());
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="server-diagnostics"
      aria-label={t("serverConnectivity")}
    >
      <h2>{t("serverConnectivity")}</h2>
      <p>{t("serverConnectivityHint")}</p>
      <dl>
        <dt>{t("connectionTarget")}</dt>
        <dd>{runtime.serverOrigin || t("connectionLocalOnly")}</dd>
      </dl>
      <Button
        type="button"
        variant="secondary"
        pending={busy}
        onClick={() => void probe()}
      >
        {t("testConnection")}
      </Button>
      {result && (
        <div
          className="server-probe-result"
          role="status"
          data-probe={result.kind}
        >
          <strong>{t(resultKey[result.kind])}</strong>
          {result.latencyMs !== null && (
            <span>{t("connectionLatency", { ms: result.latencyMs })}</span>
          )}
          {result.status !== null && (
            <span>{t("connectionStatus", { status: result.status })}</span>
          )}
          <time dateTime={result.checkedAt}>
            {t("connectionCheckedAt", {
              time: new Date(result.checkedAt).toLocaleTimeString(
                i18n.language,
              ),
            })}
          </time>
        </div>
      )}
    </section>
  );
}
