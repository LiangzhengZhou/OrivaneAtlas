import { type ComponentProps, type RefObject, useEffect, useRef } from "react";

export type DismissReason = "escape" | "outside" | "close-button";

export function DismissibleDialog({
  onRequestClose,
  modal = true,
  keyboardEntry,
  closeOnOutside = true,
  className = "",
  ...props
}: Omit<ComponentProps<"dialog">, "onCancel"> & {
  modal?: boolean;
  closeOnOutside?: boolean;
  keyboardEntry?: RefObject<HTMLElement | null> | undefined;
  onRequestClose(reason: DismissReason): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const composingEscape = useRef(false);
  const request = useRef(onRequestClose);
  request.current = onRequestClose;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement;
    const keyboardOpened = previous?.matches(":focus-visible");
    if (modal) node.showModal();
    else node.show();
    if (keyboardOpened) keyboardEntry?.current?.focus({ preventScroll: true });
    let startedOutside = false;
    const outside = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      return (
        !node.contains(event.target as Node) ||
        (event.target === node &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom))
      );
    };
    const down = (event: PointerEvent) => {
      const target = event.target as Element;
      const otherDialog = target.closest("dialog[open]");
      startedOutside = (!otherDialog || otherDialog === node) && outside(event);
    };
    const up = (event: PointerEvent) => {
      if (closeOnOutside && startedOutside && outside(event))
        request.current("outside");
      startedOutside = false;
    };
    const rememberEscape = (event: KeyboardEvent) => {
      // A modal can receive a native cancel event for the IME's Escape key.
      composingEscape.current =
        event.key === "Escape" && (event.isComposing || event.keyCode === 229);
    };
    const key = (event: KeyboardEvent) => {
      if (
        !modal &&
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        (!(event.target instanceof Element) ||
          !event.target.closest("dialog[open]") ||
          event.target.closest("dialog[open]") === node) &&
        !node.querySelector("[data-floating-surface]")
      ) {
        event.preventDefault();
        request.current("escape");
      }
    };
    node.addEventListener("keydown", rememberEscape, true);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("keydown", key);
    return () => {
      node.removeEventListener("keydown", rememberEscape, true);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("keydown", key);
      const restoreFocus =
        node.contains(document.activeElement) ||
        document.activeElement === document.body;
      node.close();
      if (
        restoreFocus &&
        previous instanceof HTMLElement &&
        previous.isConnected &&
        previous !== document.activeElement &&
        !previous.closest("[hidden]")
      )
        previous.focus({ preventScroll: true });
    };
  }, [modal, closeOnOutside, keyboardEntry]);
  return (
    <dialog
      {...props}
      ref={ref}
      className={`glass-surface ${className}`.trim()}
      onCancel={(event) => {
        event.preventDefault();
        if (composingEscape.current) {
          composingEscape.current = false;
          return;
        }
        request.current("escape");
      }}
    />
  );
}
