import { createContext, type ReactNode, useContext } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";
import "./page-header.css";

/**
 * Shell-level status controls (sync state, notifications). They are owned by
 * the shell but rendered by whichever header the current page uses, so no page
 * needs its own copy and no global bar is required.
 */
const ShellActionsContext = createContext<ReactNode>(null);
export const ShellActionsProvider = ShellActionsContext.Provider;
export function ShellActions() {
  return <>{useContext(ShellActionsContext)}</>;
}

export interface PageCrumb {
  id: string;
  label: string;
  onActivate?: (() => void) | undefined;
}

/**
 * The single header of an ordinary page: title (or breadcrumb), optional count,
 * page search/filters, page actions, then the shell actions.
 */
export function PageHeader({
  title,
  path = [],
  meta,
  search,
  actions,
  shellActions = true,
  className = "",
}: {
  title: string;
  path?: readonly PageCrumb[];
  meta?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  shellActions?: boolean;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  return (
    <header className={`page-header ${className}`}>
      <div className="page-header-title">
        {path.length ? (
          <nav
            className="breadcrumb"
            aria-label={zh ? "当前位置" : "Current location"}
          >
            {path.map((entry, index) => (
              <span key={entry.id}>
                {index > 0 && (
                  <span aria-hidden="true" className="muted">
                    {" "}
                    /{" "}
                  </span>
                )}
                {entry.onActivate ? (
                  <Button variant="ghost" onClick={entry.onActivate}>
                    {entry.label}
                  </Button>
                ) : (
                  <h1 aria-current="page">{entry.label}</h1>
                )}
              </span>
            ))}
          </nav>
        ) : (
          <h1>{title}</h1>
        )}
        {meta}
      </div>
      {search}
      <div className="page-header-actions">
        {actions}
        {shellActions && <ShellActions />}
      </div>
    </header>
  );
}
