import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { armQuickState, type QuickStateArm } from "./quick-state";

/** Arming is UI-only; only explicit confirmation invokes a business callback. */
export function InlineStateConfirm({
  entityId,
  revisionKey,
  intent,
  label,
  confirmLabel,
  disabled,
  children,
  onConfirm,
}: {
  entityId: string;
  revisionKey?: number;
  intent: QuickStateArm["intent"];
  label: string;
  confirmLabel: string;
  disabled?: boolean;
  children: ReactNode;
  onConfirm(): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const current = useRef<QuickStateArm | null>(null);
  const [armed, setArmed] = useState(false);
  function cancel() {
    current.current = null;
    setArmed(false);
  }
  useEffect(() => {
    cancel();
  }, [entityId, revisionKey, intent, disabled]);
  useEffect(() => {
    if (!armed) return;
    const expiry = current.current?.expiresAt ?? Date.now();
    const timer = window.setTimeout(cancel, Math.max(0, expiry - Date.now()));
    const outside = (event: Event) => {
      if (!button.current?.contains(event.target as Node)) cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" ||
        !button.current?.contains(event.target as Node)
      )
        cancel();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("click", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("click", outside, true);
      document.removeEventListener("focusin", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [armed]);
  return (
    <Button
      ref={button}
      variant="ghost"
      className="ui-icon-button ui-inline-state-confirm"
      disabled={disabled}
      aria-label={armed ? confirmLabel : label}
      aria-pressed={armed}
      onClick={(event) => {
        event.stopPropagation();
        const next = armQuickState(
          current.current,
          entityId,
          intent,
          Date.now(),
        );
        current.current = next.arm;
        setArmed(next.arm !== null);
        if (next.commit) onConfirm();
      }}
    >
      {children}
      <span className="sr-only" role="status">
        {armed ? confirmLabel : ""}
      </span>
    </Button>
  );
}
