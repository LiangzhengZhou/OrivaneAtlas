import { GripVertical } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { IconButton } from "./Button";
import {
  acceptsReorder,
  dragMime,
  type EntityDrag,
  readEntityDrag,
} from "./drag-intent";
import { TouchReorderScope, useTouchReorder } from "./TouchReorder";

export function SortableList({
  touchScope = true,
  ...props
}: ComponentProps<"ul"> & { touchScope?: boolean }) {
  if (!touchScope)
    return (
      <ul {...props} className={`ui-sortable-list ${props.className ?? ""}`} />
    );
  return (
    <TouchReorderScope>
      <ul {...props} className={`ui-sortable-list ${props.className ?? ""}`} />
    </TouchReorderScope>
  );
}

export function DragHandle({
  input,
  label,
  disabled,
  onMove,
  onStart,
  onEnd,
}: {
  input: EntityDrag;
  label: string;
  disabled?: boolean;
  onMove(direction: "UP" | "DOWN"): void;
  onStart?(input: EntityDrag): void;
  onEnd?(): void;
}) {
  return (
    <IconButton
      label={label}
      disabled={disabled}
      className="ui-drag-handle"
      draggable={!disabled}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(dragMime, JSON.stringify(input));
        onStart?.(input);
      }}
      onDragEnd={onEnd}
      onKeyDown={(event) => {
        if (
          disabled ||
          !event.altKey ||
          !["ArrowUp", "ArrowDown"].includes(event.key)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        onMove(event.key === "ArrowUp" ? "UP" : "DOWN");
      }}
    >
      <GripVertical size={16} />
    </IconButton>
  );
}

export function DropIndicator({
  active,
  placement = "BEFORE",
}: {
  active: boolean;
  placement?: "BEFORE" | "AFTER";
}) {
  return (
    <span
      className="ui-drop-indicator"
      data-active={active || undefined}
      data-placement={placement}
      aria-hidden="true"
    />
  );
}

/** Membership/version/reparent validation belongs to the supplied Application operation. */
export function SortableRow({
  as: Element = "li",
  entityId,
  scopeKey,
  intent = "REORDER",
  disabled,
  children,
  onMoveBefore,
  onMoveAfter,
  onStart,
}: {
  as?: "li" | "div";
  entityId: string;
  scopeKey: string;
  intent?: "REORDER" | "NAV_REORDER";
  disabled?: boolean;
  children: ReactNode;
  onMoveBefore(movingId: string, targetId: string): void;
  onMoveAfter?(movingId: string, targetId: string): void;
  onStart?(input: EntityDrag): void;
}) {
  const [over, setOver] = useState<"BEFORE" | "AFTER" | null>(null);
  const touch = useTouchReorder(
    { version: 1, intent, entityId, scopeKey },
    !!disabled,
    onMoveBefore,
    onMoveAfter,
    onStart,
  );
  return (
    <Element
      role="listitem"
      {...touch}
      data-order-entity={entityId}
      data-order-scope={scopeKey}
      data-order-intent={intent}
      data-order-disabled={disabled || undefined}
      className="ui-sortable-row"
      onDragOver={(event) => {
        if (disabled || !event.dataTransfer.types.includes(dragMime)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const bounds = event.currentTarget.getBoundingClientRect();
        setOver(
          onMoveAfter && event.clientY > bounds.top + bounds.height / 2
            ? "AFTER"
            : "BEFORE",
        );
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOver(null);
      }}
      onDrop={(event) => {
        setOver(null);
        if (disabled) return;
        const input = readEntityDrag(event.dataTransfer.getData(dragMime));
        if (!acceptsReorder(input, intent, scopeKey, entityId)) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        (onMoveAfter && event.clientY > bounds.top + bounds.height / 2
          ? onMoveAfter
          : onMoveBefore)(input.entityId, entityId);
      }}
    >
      <DropIndicator active={over === "BEFORE"} />
      {children}
      <DropIndicator active={over === "AFTER"} placement="AFTER" />
    </Element>
  );
}

export { useLongPressDrag } from "./useLongPressDrag";
