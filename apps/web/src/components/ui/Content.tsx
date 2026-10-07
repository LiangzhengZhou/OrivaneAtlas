import type { ComponentProps, ReactNode } from "react";

/** Content selection is distinct from action buttons; nested actions remain valid. */
export function PressableSurface({
  as: Surface = "div",
  selected = false,
  disabled = false,
  onSelect,
  onOpen,
  className = "",
  children,
  ...props
}: Omit<ComponentProps<"div">, "onSelect"> & {
  as?: "div" | "article";
  selected?: boolean;
  disabled?: boolean;
  onSelect?(): void;
  onOpen?(): void;
}) {
  return (
    <Surface
      {...props}
      className={`ui-pressable ${className}`}
      role={props.role ?? "button"}
      tabIndex={disabled ? -1 : (props.tabIndex ?? 0)}
      aria-disabled={disabled || undefined}
      data-selected={selected || undefined}
      onContextMenu={(event) => {
        if (disabled) return;
        if (props.onContextMenu) {
          props.onContextMenu(event);
          return;
        }
        if (
          event.target !== event.currentTarget &&
          (event.target as Element).closest("button,a,input,select,textarea")
        )
          return;
        const trigger = event.currentTarget.querySelector<HTMLButtonElement>(
          'button[aria-haspopup="menu"]',
        );
        if (!trigger || trigger.disabled) return;
        event.preventDefault();
        onSelect?.();
        trigger.click();
      }}
      onClick={(event) => {
        if (disabled) return;
        if (
          event.target !== event.currentTarget &&
          (event.target as HTMLElement).closest(
            "button,a,input,select,textarea",
          )
        )
          return;
        if (!disabled) onSelect?.();
        props.onClick?.(event);
      }}
      onDoubleClick={(event) => {
        if (disabled) return;
        if (
          (event.target as HTMLElement).closest(
            "button,a,input,select,textarea",
          )
        )
          return;
        if (!disabled) onOpen?.();
        props.onDoubleClick?.(event);
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && !disabled) {
          if (event.key === "Enter") {
            event.preventDefault();
            (onOpen ?? onSelect)?.();
          } else if (event.key === " ") {
            event.preventDefault();
            onSelect?.();
          }
        }
        props.onKeyDown?.(event);
      }}
    >
      {children}
    </Surface>
  );
}

export function ListRow({
  className = "",
  ...props
}: ComponentProps<typeof PressableSurface>) {
  return <PressableSurface {...props} className={`ui-list-row ${className}`} />;
}
export const EntityRow = ListRow;

export function ListSurface({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return <div {...props} className={`ui-list ${className}`} />;
}

export function MenuItem({
  className = "",
  type = "button",
  role = "menuitem",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      {...props}
      type={type}
      role={role}
      className={`ui-menu-item ${className}`}
    />
  );
}

export function CalendarDayCell({
  className = "",
  ...props
}: ComponentProps<typeof PressableSurface>) {
  return (
    <PressableSurface {...props} className={`ui-calendar-day ${className}`} />
  );
}

export function SectionHeader({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="ui-section-header">
      <div>
        <h2>{title}</h2>
        {children}
      </div>
      {action}
    </header>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="ui-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function StatusText({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return <span className={`ui-status ui-status-${tone}`}>{children}</span>;
}
