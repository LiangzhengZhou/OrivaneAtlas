import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export function AnchoredFloatingSurface({
  anchorRef,
  onDismiss,
  children,
  label,
  className = "",
  placement = "top-start",
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onDismiss(): void;
  children: ReactNode;
  label: string;
  className?: string;
  placement?: "top-start" | "bottom-start";
}) {
  const surface = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const node = surface.current;
    if (!anchor || !node) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const bounds = node.getBoundingClientRect();
      const above = rect.top - bounds.height - 8;
      const below = rect.bottom + 8;
      const preferred = placement === "top-start" ? above : below;
      const flipped = placement === "top-start" ? below : above;
      setPosition({
        left: Math.max(
          8,
          Math.min(rect.left, window.innerWidth - bounds.width - 8),
        ),
        top: Math.max(
          8,
          Math.min(
            preferred >= 8 &&
              preferred + bounds.height <= window.innerHeight - 8
              ? preferred
              : flipped,
            window.innerHeight - bounds.height - 8,
          ),
        ),
      });
    };
    const outside = (event: MouseEvent) => {
      if (
        !event.composedPath().includes(node) &&
        !event.composedPath().includes(anchor)
      )
        dismiss.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss.current();
      }
    };
    update();
    node.querySelector<HTMLElement>("button, input, [tabindex='0']")?.focus();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(node);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("click", outside);
    document.addEventListener("keydown", key);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", key);
      if (anchor.isConnected) anchor.focus();
    };
  }, [anchorRef, placement]);
  return createPortal(
    <div
      ref={surface}
      role="menu"
      aria-label={label}
      className={className}
      style={{
        position: "fixed",
        ...position,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100vh - 16px)",
        overflow: "auto",
        zIndex: 1000,
        background: "var(--surface, var(--bg))",
      }}
    >
      {children}
    </div>,
    anchorRef.current?.closest("dialog[open]") ?? document.body,
  );
}
