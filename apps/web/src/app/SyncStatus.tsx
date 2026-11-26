import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";

import type { WorkspaceSyncIssue } from "./workspace-sync-issue";

/** Healthy synchronization stays silent; delay transient loading feedback. */
export function SyncStatus({
  loading,
  issue,
  onRetry,
}: {
  loading: boolean;
  issue: WorkspaceSyncIssue | null;
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
  if (!issue && !slow) return null;
  return (
    <div className="sync-status" role="status">
      <span>
        {issue
          ? t(`connected:${issue}`)
          : i18n.language.startsWith("zh")
            ? "同步中…"
            : "Syncing…"}
      </span>
      {issue && (
        <Button variant="ghost" onClick={onRetry}>
          {i18n.language.startsWith("zh") ? "重试" : "Retry"}
        </Button>
      )}
    </div>
  );
}
