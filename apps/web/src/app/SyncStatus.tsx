import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";

/** Healthy synchronization stays silent; delay transient loading feedback. */
export function SyncStatus({
  loading,
  offline,
  onRetry,
}: {
  loading: boolean;
  offline: boolean;
  onRetry(): void;
}) {
  const { t, i18n } = useTranslation("desk");
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 1200);
    return () => window.clearTimeout(timer);
  }, [loading]);
  if (!offline && !slow) return null;
  return (
    <div className="sync-status" role="status">
      <span>
        {offline
          ? t("connected:offline")
          : i18n.language.startsWith("zh")
            ? "同步中…"
            : "Syncing…"}
      </span>
      {offline && (
        <Button variant="ghost" onClick={onRetry}>
          {i18n.language.startsWith("zh") ? "重试" : "Retry"}
        </Button>
      )}
    </div>
  );
}
