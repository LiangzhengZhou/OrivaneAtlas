import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";

export function Topbar({
  location,
  children,
  path = [],
}: {
  location: string;
  children: ReactNode;
  path?: readonly {
    id: string;
    label: string;
    onActivate?: (() => void) | undefined;
  }[];
}) {
  const { i18n } = useTranslation();
  return (
    <header className="topbar">
      {path.length ? (
        <nav
          className="breadcrumb"
          aria-label={
            i18n.language.startsWith("zh") ? "当前位置" : "Current location"
          }
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
                <strong aria-current="page">{entry.label}</strong>
              )}
            </span>
          ))}
        </nav>
      ) : (
        <div className="breadcrumb">
          <strong>{location}</strong>
        </div>
      )}
      <div className="topbar-actions">{children}</div>
    </header>
  );
}
