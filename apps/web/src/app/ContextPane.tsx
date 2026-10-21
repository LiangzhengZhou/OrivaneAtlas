import type { EntityRef } from "@arclattice/application";
import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../bootstrap";
import { Button, IconButton } from "../components/ui/Button";

export function ContextPane({
  selected,
  snapshot,
  onClose,
  onOpen,
  className = "",
  label,
  openLabel,
  memo,
}: {
  selected: EntityRef | null;
  snapshot: Snapshot;
  onClose(): void;
  onOpen(ref: EntityRef): void;
  className?: string;
  label?: string;
  openLabel?: string;
  memo?: ReactNode;
}) {
  const { i18n, t } = useTranslation("work");
  const zh = i18n.language.startsWith("zh");
  const entity = selected
    ? selected.kind === "WORK"
      ? snapshot.items.find((item) => item.id === selected.id)
      : selected.kind === "NOTE"
        ? snapshot.notes.find((item) => item.id === selected.id)
        : snapshot.library.find((item) => item.id === selected.id)
    : null;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      )
        onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  return (
    <aside
      className={`context-pane ${className}`}
      aria-label={label ?? (zh ? "上下文" : "Context")}
    >
      <header className="context-pane-header">
        <strong>{zh ? "检查器" : "Inspector"}</strong>
        <IconButton
          label={zh ? "关闭上下文" : "Close context"}
          onClick={onClose}
        >
          <X />
        </IconButton>
      </header>
      {entity && !entity.deletedAt ? (
        <div className="entity-inspector">
          <h2>{entity.title}</h2>
          {"status" in entity && (
            <p className="muted">{t(`statuses.${entity.status}`)}</p>
          )}
          {"dueDate" in entity && entity.dueDate && (
            <time dateTime={entity.dueDate}>{entity.dueDate}</time>
          )}
          {selected && (
            <Button variant="ghost" onClick={() => onOpen(selected)}>
              {openLabel ?? (zh ? "打开" : "Open")}
            </Button>
          )}
          {memo}
        </div>
      ) : (
        <p className="muted entity-inspector">
          {zh ? "选择一项查看详情" : "Select an item to see details"}
        </p>
      )}
    </aside>
  );
}
