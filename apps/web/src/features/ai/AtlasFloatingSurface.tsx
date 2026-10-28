import { GripHorizontal, PanelRight, X } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
} from "react";
import { IconButton } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Surfaces";
import "./atlas-floating.css";

/** Nonmodal: writing outside the float remains possible without dismissing it. */
export function AtlasFloatingSurface({
  zh,
  label,
  onClose,
  children,
}: {
  zh: boolean;
  label: string;
  onClose(): void;
  children: ReactNode;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const move = (node: HTMLDialogElement, left: number, top: number) => {
    node.style.left = `${Math.max(8, Math.min(left, window.innerWidth - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(top, window.innerHeight - node.offsetHeight - 8))}px`;
    node.style.right = "auto";
    node.style.bottom = "auto";
  };
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const node = event.currentTarget.closest("dialog");
    if (!node) return;
    const rect = node.getBoundingClientRect();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const node = event.currentTarget.closest("dialog");
    if (
      !node ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    move(
      node,
      rect.left +
        (event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0),
      rect.top +
        (event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0),
    );
  };
  return (
    <Dialog
      modal={false}
      closeOnOutside={false}
      className="atlas-floating-surface glass-surface"
      aria-label={label}
      onRequestClose={onClose}
    >
      <header className="atlas-floating-header">
        <IconButton
          label={
            zh
              ? "移动 Atlas（方向键可用）"
              : "Move Atlas (arrow keys available)"
          }
          onPointerDown={start}
          onPointerMove={(event) => {
            const node = event.currentTarget.closest("dialog");
            if (node && drag.current)
              move(
                node,
                drag.current.left + event.clientX - drag.current.x,
                drag.current.top + event.clientY - drag.current.y,
              );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={keyboard}
          className="atlas-floating-grip"
        >
          <GripHorizontal />
        </IconButton>
        <strong>Atlas</strong>
        <IconButton
          label={zh ? "将 Atlas 靠右" : "Dock Atlas to the right"}
          onClick={(event) => {
            const node = event.currentTarget.closest("dialog");
            if (node) {
              node.style.left = "auto";
              node.style.top = "auto";
              node.style.right = "16px";
              node.style.bottom = "16px";
            }
          }}
        >
          <PanelRight />
        </IconButton>
        <IconButton label={zh ? "关闭 Atlas" : "Close Atlas"} onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="atlas-floating-body">{children}</div>
    </Dialog>
  );
}
