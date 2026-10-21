import type { ComponentProps, ReactNode } from "react";
import { type SurfaceIntent, surfaceAction } from "./interaction-intent";

/** Content selection is distinct from action buttons; nested actions remain valid. */
export function PressableSurface({
  as: Surface = "div",
  selected = false,
  disabled = false,
  intent = "SELECT",
  onSelect,
  onOpen,
  className = "",
  children,
  ...props
}: Omit<ComponentProps<"div">, "onSelect"> & {
  as?: "div" | "article";
  selected?: boolean;
  disabled?: boolean;
  intent?: SurfaceIntent;
  onSelect?(): void;
  onOpen?(): void;
}) {
  function activate(input: Parameters<typeof surfaceAction>[1]) {
    const action = surfaceAction(intent, input);
    if (action === "OPEN") (onOpen ?? onSelect)?.();
    else if (action === "SELECT") onSelect?.();
  }
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
        activate("CLICK");
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
        activate("DOUBLE_CLICK");
        props.onDoubleClick?.(event);
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && !disabled) {
          if (event.key === "Enter") {
            event.preventDefault();
            activate("ENTER");
          } else if (event.key === " ") {
            event.preventDefault();
            activate("SPACE");
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

export function NavigationRow(
  props: Omit<ComponentProps<typeof ListRow>, "intent" | "onSelect">,
) {
  return <ListRow {...props} intent="NAVIGATE" />;
}

export function SelectableRow(
  props: Omit<ComponentProps<typeof ListRow>, "intent">,
) {
  return <ListRow {...props} intent="SELECT" />;
}

export function InspectableRow(
  props: Omit<ComponentProps<typeof ListRow>, "intent">,
) {
  return <ListRow {...props} intent="INSPECT" />;
}

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
