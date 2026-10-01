import type { ReactNode } from "react";

export function Topbar({
  workspace,
  location,
  children,
}: {
  workspace: string;
  location: string;
  children: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span>{workspace}</span>
        <span aria-hidden="true">/</span>
        <strong>{location}</strong>
      </div>
      <div className="topbar-actions">{children}</div>
    </header>
  );
}
