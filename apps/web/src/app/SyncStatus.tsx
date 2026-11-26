import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";
import { AnchoredFloatingSurface } from "./AnchoredFloatingSurface";
import type {
  WorkspaceSyncDiagnostic,
  WorkspaceSyncIssue,
} from "./workspace-sync-issue";

/** Healthy synchronization stays silent; delay transient loading feedback. */
export function SyncStatus({
  loading,
  issue,
  diagnostic,
  onRetry,
}: {
  loading: boolean;
  issue: WorkspaceSyncIssue | null;
  diagnostic: WorkspaceSyncDiagnostic | null;
  onRetry(): void;
}) {
  const { t, i18n } = useTranslation("desk");
  const [slow, setSlow] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!issue) setDetailsOpen(false);
  }, [issue]);
  useEffect(() => {
    setSlow(false);
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 1200);
    return () => window.clearTimeout(timer);
  }, [loading]);
  if (!issue && !slow) return null;
  const label = issue
    ? t(`connected:${issue}`)
    : i18n.language.startsWith("zh")
      ? "同步中…"
      : "Syncing…";
  return (
    <div className="sync-status" role="status">
      {issue && diagnostic ? (
        <Button
          variant="text"
          ref={trigger}
          aria-haspopup="dialog"
          aria-expanded={detailsOpen}
          aria-label={t("connected:syncShowDetails", { issue: label })}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {label}
        </Button>
      ) : (
        <span>{label}</span>
      )}
      {issue && (
        <Button variant="ghost" onClick={onRetry}>
          {i18n.language.startsWith("zh") ? "重试" : "Retry"}
        </Button>
      )}
      {detailsOpen && issue && diagnostic && (
        <AnchoredFloatingSurface
          anchorRef={trigger}
          role="dialog"
          placement="bottom-start"
          className="ui-popover sync-details"
          label={t("connected:syncDetails")}
          onDismiss={() => setDetailsOpen(false)}
        >
          <strong>{t("connected:syncDetails")}</strong>
          <dl>
            <dt>{t("connected:syncStage")}</dt>
            <dd>{t(`connected:syncStages.${diagnostic.stage}`)}</dd>
            <dt>{t("connected:syncCode")}</dt>
            <dd>
              <code>{diagnostic.code}</code>
            </dd>
            {diagnostic.httpStatus !== null && (
              <>
                <dt>HTTP</dt>
                <dd>{diagnostic.httpStatus}</dd>
              </>
            )}
          </dl>
          <Button variant="ghost" onClick={() => setDetailsOpen(false)}>
            {t("common:close")}
          </Button>
        </AnchoredFloatingSurface>
      )}
    </div>
  );
}
