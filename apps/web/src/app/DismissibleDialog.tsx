import { type ComponentProps, useEffect, useRef } from "react";

export type DismissReason = "escape" | "outside" | "close-button";

export function DismissibleDialog({
  onRequestClose,
  modal = true,
  ...props
}: Omit<ComponentProps<"dialog">, "onCancel"> & {
  modal?: boolean;
  onRequestClose(reason: DismissReason): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const request = useRef(onRequestClose);
  request.current = onRequestClose;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement;
    if (modal) node.showModal();
    else node.show();
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
      startedOutside = outside(event);
    };
    const up = (event: PointerEvent) => {
      if (startedOutside && outside(event)) request.current("outside");
      startedOutside = false;
    };
    const key = (event: KeyboardEvent) => {
      if (!modal && event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        request.current("escape");
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("keydown", key);
      node.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [modal]);
  return (
    <dialog
      {...props}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        request.current("escape");
      }}
    />
  );
}
