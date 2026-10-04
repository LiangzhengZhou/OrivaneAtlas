import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface FloatingFamily {
  parent: FloatingFamily | null;
  descendants: Set<HTMLElement>;
}
const FloatingFamilyContext = createContext<FloatingFamily | null>(null);

export function AnchoredFloatingSurface({
  anchorRef,
  onDismiss,
  children,
  label,
  className = "",
  placement = "top-start",
  portalTarget,
  dismissBoundaryRef,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onDismiss(): void;
  children: ReactNode;
  label: string;
  className?: string;
  placement?: "top-start" | "bottom-start";
  portalTarget?: Element | undefined;
  dismissBoundaryRef?: RefObject<HTMLElement | null>;
}) {
  const parent = useContext(FloatingFamilyContext);
  const family = useMemo<FloatingFamily>(
    () => ({ parent, descendants: new Set() }),
    [parent],
  );
  const surface = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const node = surface.current;
    if (!anchor || !node) return;
    const ancestors: FloatingFamily[] = [];
    for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
      ancestor.descendants.add(node);
      ancestors.push(ancestor);
    }
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
      const path = event.composedPath();
      if (
        !path.includes(node) &&
        !path.includes(anchor) &&
        !path.includes(dismissBoundaryRef?.current ?? anchor) &&
        ![...family.descendants].some((descendant) => path.includes(descendant))
      )
        dismiss.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && family.descendants.size === 0) {
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
      for (const ancestor of ancestors) ancestor.descendants.delete(node);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", key);
      if (anchor.isConnected) anchor.focus();
    };
  }, [anchorRef, placement, parent, family, dismissBoundaryRef]);
  return createPortal(
    <FloatingFamilyContext.Provider value={family}>
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
      </div>
    </FloatingFamilyContext.Provider>,
    portalTarget ?? anchorRef.current?.closest("dialog[open]") ?? document.body,
  );
}
