import { type ReactNode, useRef, useState } from "react";
import { dragMime, type EntityDrag, readEntityDrag } from "./drag-intent";
import { useTouchHierarchyTarget } from "./TouchReorder";

/** Target supplies authoritative eligibility; edge insertion remains the sortable parent's job. */
export function HierarchyDropTarget({
  children,
  activeDrag,
  canDrop,
  onDrop,
  label,
  disabled,
  edges = true,
  dropIntent,
}: {
  children: ReactNode;
  activeDrag: EntityDrag | null;
  canDrop(input: EntityDrag): boolean;
  onDrop(input: EntityDrag): void;
  label: string;
  disabled: boolean;
  edges?: boolean;
  dropIntent?: "PROJECT_REPARENT" | "MOVE_CATEGORY";
}) {
  const [over, setOver] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const commit = (input: EntityDrag) =>
    onDrop(dropIntent ? { ...input, intent: dropIntent } : input);
  useTouchHierarchyTarget(element, {
    canDrop,
    onDrop: commit,
    disabled,
    edges,
  });
  const isEdge = (element: HTMLElement, y: number) => {
    if (!edges) return false;
    const bounds = element.getBoundingClientRect();
    return (
      y < bounds.top + bounds.height * 0.2 ||
      y > bounds.bottom - bounds.height * 0.2
    );
  };
  return (
    <div
      ref={element}
      className="ui-hierarchy-drop-target"
      data-hierarchy-over={over || undefined}
      onDragOver={(event) => {
        if (
          !activeDrag ||
          !event.dataTransfer.types.includes(dragMime) ||
          isEdge(event.currentTarget, event.clientY)
        ) {
          setOver(false);
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        const allowed = !disabled && canDrop(activeDrag);
        event.dataTransfer.dropEffect = allowed ? "move" : "none";
        setOver(allowed);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        if (isEdge(event.currentTarget, event.clientY)) return;
        const input = readEntityDrag(event.dataTransfer.getData(dragMime));
        if (!input) return;
        event.stopPropagation();
        event.preventDefault();
        if (!disabled && canDrop(input)) commit(input);
      }}
    >
      {children}
      {
        <span className="ui-hierarchy-drop-label" role="status">
          {label}
        </span>
      }
    </div>
  );
}
