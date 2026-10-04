import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useId,
  useState,
} from "react";
import { AnchoredFloatingSurface } from "../../app/AnchoredFloatingSurface";
import { DismissibleDialog } from "../../app/DismissibleDialog";
import { Button } from "./Button";

export const Dialog = DismissibleDialog;

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  pending = false,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const id = useId();
  return (
    <Dialog
      className="ui-dialog"
      aria-labelledby={id}
      onRequestClose={() => {
        if (!pending) onCancel();
      }}
    >
      <h2 id={id}>{title}</h2>
      {children}
      <div className="ui-toolbar">
        <Button disabled={pending} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          pending={pending}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export function Popover({
  anchorRef,
  label,
  children,
  onDismiss,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
  onDismiss(): void;
}) {
  return (
    <AnchoredFloatingSurface
      anchorRef={anchorRef}
      label={label}
      onDismiss={onDismiss}
      placement="bottom-start"
      className="ui-popover"
    >
      {children}
    </AnchoredFloatingSurface>
  );
}

export function Menu(props: ComponentProps<typeof Popover>) {
  return (
    <Popover {...props}>
      <div
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          if (!items.length) return;
          event.preventDefault();
          const current = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (current +
                    (event.key === "ArrowUp" ? -1 : 1) +
                    items.length) %
                  items.length;
          items[next]?.focus();
        }}
      >
        {props.children}
      </div>
    </Popover>
  );
}

export function Select({
  label,
  className = "",
  ...props
}: ComponentProps<"select"> & { label?: string }) {
  return (
    <select
      {...props}
      aria-label={label ?? props["aria-label"]}
      className={`ui-select ${className}`}
    />
  );
}
export const Dropdown = Select;

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="ui-tooltip-anchor"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      aria-describedby={visible ? id : undefined}
    >
      {children}
      {visible && (
        <span id={id} role="tooltip" className="ui-tooltip">
          {label}
        </span>
      )}
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="ui-empty-state">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
      {action}
    </section>
  );
}
