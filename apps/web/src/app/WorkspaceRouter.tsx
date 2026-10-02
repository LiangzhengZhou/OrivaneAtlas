import type { ReactNode } from "react";
import type { View } from "./navigation";

export function WorkspaceRouter({
  view,
  hidden,
  children,
}: {
  view: View;
  hidden: boolean;
  children: ReactNode;
}) {
  const mode =
    view === "settings" || view === "account" || view === "admin"
      ? "standard"
      : view === "calendar" || view === "library"
        ? "full"
        : "wide";
  return (
    <div className="content" data-content-mode={mode} hidden={hidden}>
      {children}
    </div>
  );
}
