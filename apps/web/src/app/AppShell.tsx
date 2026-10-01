import type { ReactNode } from "react";

export function AppShell({
  collapsed,
  mobileOpen,
  children,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        "app-shell " +
        (collapsed ? "sidebar-collapsed " : "") +
        (mobileOpen ? "mobile-navigation-open" : "mobile-navigation-closed")
      }
    >
      {children}
    </div>
  );
}
