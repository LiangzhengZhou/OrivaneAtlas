import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

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
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      id="mobile-more-sheet"
      className="mobile-more-sheet"
      aria-labelledby="mobile-more-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
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
    </dialog>
  );
}
