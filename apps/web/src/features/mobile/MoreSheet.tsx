import { useTranslation } from "react-i18next";
import { DismissibleDialog } from "../../app/DismissibleDialog";

export function MoreSheet({
  entries,
  onNavigate,
  onClose,
}: {
  entries: readonly { id: string; label: string }[];
  onNavigate(id: string): void;
  onClose(): void;
}) {
  const { t } = useTranslation(["desk", "common"]);
  return (
    <DismissibleDialog
      onRequestClose={onClose}
      id="mobile-more-sheet"
      className="mobile-more-sheet"
      aria-labelledby="mobile-more-title"
    >
      <header>
        <h2 id="mobile-more-title">{t("moreNavigation")}</h2>
        <button type="button" className="text-button" onClick={onClose}>
          {t("common:close")}
        </button>
      </header>
      <nav aria-label={t("moreNavigation")}>
        {entries.map((entry) => (
          <button
            type="button"
            key={entry.id}
            onClick={() => onNavigate(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
    </DismissibleDialog>
  );
}
