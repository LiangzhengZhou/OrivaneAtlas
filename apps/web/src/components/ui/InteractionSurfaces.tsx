import { ChevronRight, MoreHorizontal, X } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "./Button";
import { Dialog, Menu } from "./Surfaces";

export function EditorActionsMenu({
  pending,
  onDelete,
  label,
  deleteLabel,
}: {
  pending: boolean;
  onDelete: (() => Promise<void>) | null;
  label?: string;
  deleteLabel?: string;
}) {
  const { t } = useTranslation("common");
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!onDelete) return null;
  return (
    <>
      <IconButton
        ref={anchor}
        label={label ?? t("moreActions")}
        disabled={pending}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={18} />
      </IconButton>
      {open && (
        <Menu
          anchorRef={anchor}
          label={t("moreActions")}
          onDismiss={() => setOpen(false)}
        >
          <Button
            role="menuitem"
            variant="danger"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              void onDelete();
            }}
          >
            {deleteLabel ?? t("delete")}
          </Button>
        </Menu>
      )}
    </>
  );
}

/** A single scrolling body and stable actions are shared by quick/full editors. */
export function EditorShell({
  title,
  children,
  footer,
  pending = false,
  modal = true,
  actions,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  pending?: boolean;
  modal?: boolean;
  actions?: ReactNode;
  onClose(): void;
  className?: string;
}) {
  const id = useId();
  const { i18n } = useTranslation();
  return (
    <Dialog
      modal={modal}
      className={`ui-editor-shell ${className}`}
      aria-labelledby={id}
      onRequestClose={() => {
        if (!pending) onClose();
      }}
    >
      <header className="ui-editor-header">
        <h2 id={id}>{title}</h2>
        {actions}
        <IconButton
          label={i18n.language.startsWith("zh") ? "关闭" : "Close"}
          disabled={pending}
          onClick={onClose}
        >
          <X size={18} />
        </IconButton>
      </header>
      <div className="ui-editor-body">{children}</div>
      <footer className="ui-editor-footer">{footer}</footer>
    </Dialog>
  );
}

export function FormSection({
  title,
  hideTitle = false,
  children,
}: {
  title: string;
  hideTitle?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="ui-form-section" aria-labelledby={id}>
      <h3 id={id} className={hideTitle ? "sr-only" : undefined}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function DisclosureSection({
  title,
  children,
  ...props
}: Omit<ComponentProps<"details">, "title"> & { title: string }) {
  return (
    <details {...props} className={`ui-disclosure ${props.className ?? ""}`}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}

export function PropertyList(props: ComponentProps<"dl">) {
  return (
    <dl {...props} className={`ui-property-list ${props.className ?? ""}`} />
  );
}

export function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="ui-property-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PropertyPicker({
  label,
  value,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "value"> & {
  label: string;
  value: ReactNode;
}) {
  return (
    <Button
      {...props}
      variant="ghost"
      className="ui-property-picker"
      aria-label={label}
    >
      <span>{value}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </Button>
  );
}

export const SettingsSection = FormSection;

export function SettingsRow({
  label,
  description,
  value,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "value"> & {
  label: string;
  description?: string;
  value?: ReactNode;
}) {
  return (
    <Button {...props} variant="ghost" className="ui-settings-row">
      <span className="ui-settings-identity">
        <span>{label}</span>
        {description && <small>{description}</small>}
      </span>
      {value && <span className="ui-settings-value">{value}</span>}
      <ChevronRight size={16} aria-hidden="true" />
    </Button>
  );
}
