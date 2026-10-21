import { type PointerEvent, useEffect, useRef } from "react";

/** A scroll cancels before arming; only a stationary 400ms touch starts a drag. */
export function useLongPressDrag(
  onBegin: () => void,
  disabled = false,
  identity = "",
) {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const begin = useRef(onBegin);
  begin.current = onBegin;
  function cancel() {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
    start.current = null;
  }
  useEffect(() => {
    if (disabled) cancel();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("keydown", escape);
    return () => {
      cancel();
      document.removeEventListener("keydown", escape);
    };
  }, [disabled, identity]);
  return {
    onPointerDown(event: PointerEvent) {
      cancel();
      if (disabled || event.pointerType === "mouse" || event.button !== 0)
        return;
      start.current = { x: event.clientX, y: event.clientY };
      pending.current = setTimeout(() => {
        pending.current = null;
        start.current = null;
        begin.current();
      }, 400);
    },
    onPointerMove(event: PointerEvent) {
      if (
        start.current &&
        Math.hypot(
          event.clientX - start.current.x,
          event.clientY - start.current.y,
        ) > 8
      )
        cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}
