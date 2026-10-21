import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import type { EntityDrag } from "./drag-intent";
import { useLongPressDrag } from "./useLongPressDrag";

type Gesture = {
  pointerId: number;
  input: EntityDrag;
  source: HTMLElement;
  onMoveBefore(movingId: string, targetId: string): void;
  onMoveAfter?: ((movingId: string, targetId: string) => void) | undefined;
};
const TouchReorderContext = createContext<((gesture: Gesture) => void) | null>(
  null,
);
type HierarchyTarget = {
  canDrop(input: EntityDrag): boolean;
  onDrop(input: EntityDrag): void;
  disabled: boolean;
  edges: boolean;
};
const HierarchyTouchContext = createContext<Map<
  HTMLElement,
  HierarchyTarget
> | null>(null);
export function useTouchHierarchyTarget(
  element: React.RefObject<HTMLDivElement | null>,
  options: HierarchyTarget,
) {
  const registry = useContext(HierarchyTouchContext);
  useEffect(() => {
    const target = element.current;
    if (!registry || !target) return;
    registry.set(target, options);
    return () => {
      registry.delete(target);
    };
  }, [registry, element, options]);
}

/** Owns the gesture outside virtual rows, so scrolling may unmount the source row. */
export function TouchReorderScope({ children }: { children: ReactNode }) {
  const active = useRef<Gesture | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const hierarchyTargets = useRef(new Map<HTMLElement, HierarchyTarget>());
  const hierarchyDestination = useRef<HTMLElement | null>(null);
  const placement = useRef<"BEFORE" | "AFTER">("BEFORE");
  const clickUntil = useRef(0);
  const point = useRef<{ x: number; y: number } | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const starter = useRef((gesture: Gesture) => {
    active.current?.source.removeAttribute("data-reordering");
    hierarchyDestination.current?.removeAttribute("data-hierarchy-over");
    hierarchyDestination.current = null;
    target.current?.removeAttribute("data-touch-drop");
    target.current = null;
    point.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    active.current = gesture;
    gesture.source.setAttribute("data-reordering", "true");
    navigator.vibrate?.(15);
  });
  useEffect(() => {
    const clear = () => {
      active.current?.source.removeAttribute("data-reordering");
      hierarchyDestination.current?.removeAttribute("data-hierarchy-over");
      hierarchyDestination.current = null;
      target.current?.removeAttribute("data-touch-drop");
      active.current = null;
      target.current = null;
      point.current = null;
      if (scrollFrame.current !== null)
        cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    };
    const updateTarget = () => {
      const gesture = active.current;
      const position = point.current;
      if (!gesture || !position) return null;
      const hit = document.elementFromPoint(position.x, position.y);
      const hierarchy = hit?.closest<HTMLElement>(".ui-hierarchy-drop-target");
      const hierarchyOptions = hierarchy
        ? hierarchyTargets.current.get(hierarchy)
        : undefined;
      const bounds = hierarchy?.getBoundingClientRect();
      const inBody = !!(
        bounds &&
        hierarchyOptions &&
        (!hierarchyOptions.edges ||
          (position.y >= bounds.top + bounds.height * 0.2 &&
            position.y <= bounds.bottom - bounds.height * 0.2))
      );
      const structural =
        inBody &&
        hierarchyOptions &&
        !hierarchyOptions.disabled &&
        hierarchyOptions.canDrop(gesture.input)
          ? hierarchy!
          : null;
      if (structural !== hierarchyDestination.current) {
        hierarchyDestination.current?.removeAttribute("data-hierarchy-over");
        hierarchyDestination.current = structural;
        structural?.setAttribute("data-hierarchy-over", "true");
      }
      const row = hit?.closest<HTMLElement>("[data-order-entity]");
      const candidate =
        !inBody &&
        row?.dataset.orderScope === gesture.input.scopeKey &&
        row.dataset.orderIntent === gesture.input.intent &&
        row.dataset.orderDisabled !== "true" &&
        row.dataset.orderEntity !== gesture.input.entityId
          ? row
          : null;
      if (candidate !== target.current) {
        target.current?.removeAttribute("data-touch-drop");
        target.current = candidate;
      }
      if (candidate) {
        const bounds = candidate.getBoundingClientRect();
        placement.current =
          gesture.onMoveAfter && position.y > bounds.top + bounds.height / 2
            ? "AFTER"
            : "BEFORE";
        if (candidate.dataset.touchDrop !== placement.current)
          candidate.setAttribute("data-touch-drop", placement.current);
      }
      const scroller = hit?.closest<HTMLElement>(".virtual-task-scroll");
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const delta =
          position.y < bounds.top + 36
            ? -12
            : position.y > bounds.bottom - 36
              ? 12
              : 0;
        if (
          delta &&
          ((delta < 0 && scroller.scrollTop > 0) ||
            (delta > 0 &&
              scroller.scrollTop + scroller.clientHeight <
                scroller.scrollHeight))
        )
          return { scroller, delta };
      }
      return null;
    };
    const scroll = () => {
      scrollFrame.current = null;
      const edge = updateTarget();
      if (!edge) return;
      edge.scroller.scrollBy(0, edge.delta);
      scrollFrame.current = requestAnimationFrame(scroll);
    };
    const move = (event: PointerEvent) => {
      if (!active.current || event.pointerId !== active.current.pointerId)
        return;
      point.current = { x: event.clientX, y: event.clientY };
      const edge = updateTarget();
      if (edge && scrollFrame.current === null)
        scrollFrame.current = requestAnimationFrame(scroll);
    };
    const finish = (event: PointerEvent) => {
      if (!active.current || event.pointerId !== active.current.pointerId)
        return;
      updateTarget();
      const gesture = active.current;
      const destination = target.current;
      const structural = hierarchyDestination.current;
      const structuralOptions = structural
        ? hierarchyTargets.current.get(structural)
        : undefined;
      clear();
      clickUntil.current = Date.now() + 400;
      if (
        gesture.source.dataset.orderDisabled !== "true" &&
        structural?.isConnected &&
        structuralOptions &&
        !structuralOptions.disabled &&
        structuralOptions.canDrop(gesture.input)
      ) {
        structuralOptions.onDrop(gesture.input);
        return;
      }
      if (
        gesture.source.dataset.orderDisabled !== "true" &&
        destination?.isConnected &&
        destination.dataset.orderScope === gesture.input.scopeKey &&
        destination.dataset.orderIntent === gesture.input.intent &&
        destination.dataset.orderEntity &&
        destination.dataset.orderDisabled !== "true"
      )
        (placement.current === "AFTER" && gesture.onMoveAfter
          ? gesture.onMoveAfter
          : gesture.onMoveBefore)(
          gesture.input.entityId,
          destination.dataset.orderEntity,
        );
    };
    const cancel = () => {
      if (active.current) clickUntil.current = Date.now() + 400;
      clear();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    const pointerCancel = (event: PointerEvent) => {
      if (active.current?.pointerId === event.pointerId) cancel();
    };
    const touch = (event: TouchEvent) => {
      if (active.current && event.cancelable) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (event.detail !== 0 && Date.now() < clickUntil.current) {
        event.preventDefault();
        event.stopPropagation();
        clickUntil.current = 0;
      }
    };
    const nextPointer = (event: PointerEvent) => {
      // A fresh user gesture is not the compatibility click generated by release.
      if (!active.current && event.isTrusted) clickUntil.current = 0;
    };
    const menu = (event: Event) => {
      if (active.current) event.preventDefault();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", pointerCancel);
    document.addEventListener("keydown", key);
    document.addEventListener("touchmove", touch, { passive: false });
    document.addEventListener("click", click, true);
    document.addEventListener("pointerdown", nextPointer, true);
    document.addEventListener("contextmenu", menu, true);
    return () => {
      clear();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", pointerCancel);
      document.removeEventListener("keydown", key);
      document.removeEventListener("touchmove", touch);
      document.removeEventListener("click", click, true);
      document.removeEventListener("pointerdown", nextPointer, true);
      document.removeEventListener("contextmenu", menu, true);
    };
  }, []);
  return (
    <TouchReorderContext.Provider value={starter.current}>
      <HierarchyTouchContext.Provider value={hierarchyTargets.current}>
        {children}
      </HierarchyTouchContext.Provider>
    </TouchReorderContext.Provider>
  );
}

export function useTouchReorder(
  input: EntityDrag,
  disabled: boolean,
  onMoveBefore: Gesture["onMoveBefore"],
  onMoveAfter?: Gesture["onMoveAfter"],
  onStart?: (input: EntityDrag) => void,
) {
  const start = useContext(TouchReorderContext);
  const source = useRef<{ element: HTMLElement; pointerId: number } | null>(
    null,
  );
  const latest = useRef({ input, onMoveBefore, onMoveAfter, onStart });
  latest.current = { input, onMoveBefore, onMoveAfter, onStart };
  const hold = useLongPressDrag(
    () => {
      if (source.current && start) {
        latest.current.onStart?.(latest.current.input);
        start({
          ...latest.current,
          source: source.current.element,
          pointerId: source.current.pointerId,
        });
      }
    },
    disabled || !start,
    JSON.stringify([input.scopeKey, input.entityId]),
  );
  return {
    ...hold,
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      if (!event.isPrimary) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-order-entity]") !== event.currentTarget
      )
        return;
      const interactive =
        event.target instanceof Element
          ? event.target.closest("button,a,input,select,textarea")
          : null;
      if (
        interactive &&
        !interactive.matches(".ui-drag-handle,[data-reorder-surface]")
      )
        return;
      source.current = {
        element: event.currentTarget,
        pointerId: event.pointerId,
      };
      hold.onPointerDown(event);
    },
  };
}
