import type { ComponentProps, ReactNode } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "text"
  | "danger"
  | "toggle";

export function Button({
  variant = "secondary",
  pending = false,
  className = "",
  disabled,
  children,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; pending?: boolean }) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-button ui-button-${variant} ${className}`}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending && <span className="ui-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  variant = "ghost",
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Button
      {...props}
      variant={variant}
      aria-label={label}
      title={label}
      className={`ui-icon-button ${props.className ?? ""}`}
    >
      {children}
    </Button>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange(value: T): void;
  disabled?: boolean;
}) {
  return (
    <div className="ui-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          variant="toggle"
          aria-pressed={value === option.value}
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function Toolbar({ className = "", ...props }: ComponentProps<"div">) {
  return <div {...props} className={`ui-toolbar ${className}`} />;
}
