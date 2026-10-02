import { type ReactNode, useEffect, useRef, useState } from "react";

export function DocumentPopover({
  label,
  className,
  children,
  requestOpen = 0,
}: {
  label: ReactNode;
  className: string;
  children: ReactNode;
  requestOpen?: number;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (requestOpen > 0) setOpen(true);
  }, [requestOpen]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className={className + " document-popover"} ref={root}>
      <button
        type="button"
        className="chip"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div className="document-popover-panel" role="dialog">
          {children}
        </div>
      )}
    </div>
  );
}
