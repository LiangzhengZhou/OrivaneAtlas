import { useTranslation } from "react-i18next";
import { DismissibleDialog } from "../../app/DismissibleDialog";
import { Button } from "../../components/ui/Button";
import {
  DragHandle,
  SortableList,
  SortableRow,
} from "../../components/ui/Sortable";

export function MoreSheet({
  entries,
  onNavigate,
  onClose,
  onReorder,
  reorderPending,
}: {
  entries: readonly { id: string; label: string; scopeKey?: string }[];
  onReorder(
    moving: string,
    anchor: string,
    placement: "BEFORE" | "AFTER",
  ): void;
  reorderPending: boolean;
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
        <Button variant="ghost" type="button" onClick={onClose}>
          {t("common:close")}
        </Button>
      </header>
      <nav aria-label={t("moreNavigation")}>
        <SortableList>
          {entries.map((entry) => {
            const peers = entries.filter(
              (peer) => entry.scopeKey && peer.scopeKey === entry.scopeKey,
            );
            const position = peers.indexOf(entry);
            return (
              <SortableRow
                key={entry.id}
                entityId={entry.id}
                scopeKey={entry.scopeKey ?? "NAV:unsupported"}
                intent="NAV_REORDER"
                disabled={reorderPending || peers.length < 2}
                onMoveBefore={(moving, anchor) =>
                  onReorder(moving, anchor, "BEFORE")
                }
                onMoveAfter={(moving, anchor) =>
                  onReorder(moving, anchor, "AFTER")
                }
              >
                <Button
                  type="button"
                  key={entry.id}
                  onClick={() => onNavigate(entry.id)}
                  data-reorder-surface="true"
                >
                  {entry.label}
                </Button>
                {peers.length > 1 && (
                  <DragHandle
                    label={t("moveNavigationItem", { title: entry.label })}
                    input={{
                      version: 1,
                      intent: "NAV_REORDER",
                      entityId: entry.id,
                      scopeKey: entry.scopeKey!,
                    }}
                    disabled={reorderPending}
                    onMove={(direction) => {
                      const anchor =
                        peers[position + (direction === "UP" ? -1 : 1)];
                      if (anchor)
                        onReorder(
                          entry.id,
                          anchor.id,
                          direction === "UP" ? "BEFORE" : "AFTER",
                        );
                    }}
                  />
                )}
              </SortableRow>
            );
          })}
        </SortableList>
      </nav>
    </DismissibleDialog>
  );
}
