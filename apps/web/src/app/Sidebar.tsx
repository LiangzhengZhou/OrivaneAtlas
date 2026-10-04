import { GripVertical, LogOut, PanelLeft, Settings2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchoredFloatingSurface } from "./AnchoredFloatingSurface";
import { type NavigationView, navigation, type View } from "./navigation";

export function Sidebar({
  collapsed,
  mobileOpen,
  canAdmin,
  activeView,
  navigationOrder,
  taskCount,
  noteCount,
  label,
  onNavigate,
  onToggleMobile,
  onToggleCollapsed,
  onDragNavigation,
  onMoveNavigation,
  onLogout,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  canAdmin: boolean;
  activeView: View;
  navigationOrder: readonly NavigationView[];
  taskCount: string;
  noteCount: string;
  label(value: string): string;
  onNavigate(view: View): void;
  onToggleMobile(): void;
  onToggleCollapsed(): void;
  onDragNavigation(view: NavigationView): void;
  onMoveNavigation(view: NavigationView): void;
  onLogout(): void;
}) {
  const { t } = useTranslation("desk");
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const groups = [
    {
      label: t("workspace"),
      views: ["overview", "focus", "tasks", "projects", "calendar"],
    },
    { label: t("knowledge"), views: ["notes", "journal", "library"] },
    { label: "", views: ["ai"] },
  ];
  return (
    <aside className="sidebar" id="workspace-sidebar">
      <div className="brand sidebar-header">
        <img
          className="brand-logo"
          src="/orivane-atlas.png"
          alt="Orivane Atlas"
        />
        <button
          type="button"
          className="icon-button sidebar-collapse-button"
          aria-label={t(collapsed ? "expandSidebar" : "collapseSidebar")}
          aria-expanded={!collapsed}
          aria-controls="workspace-sidebar"
          onClick={onToggleCollapsed}
        >
          <PanelLeft size={18} />
        </button>
      </div>
      <button
        type="button"
        className="icon-button mobile-navigation-toggle"
        aria-label={t(mobileOpen ? "collapseSidebar" : "expandSidebar")}
        aria-expanded={mobileOpen}
        aria-controls="mobile-more-sheet"
        onClick={() => onToggleMobile()}
      >
        <PanelLeft size={20} />
      </button>
      <nav id="workspace-navigation" aria-label={t("workspace")}>
        {groups.map((group) => (
          <section key={group.views.join("-")}>
            {group.label && <p className="section-label">{group.label}</p>}
            {navigationOrder
              .filter((next) => group.views.includes(next))
              .map((next) => navigation.find((item) => item.view === next)!)
              .filter(Boolean)
              .filter((n) => n.view !== "admin" || canAdmin)
              .map(({ view: next, icon: Icon }) => (
                <button
                  type="button"
                  key={next}
                  className={
                    "nav-item " + (activeView === next ? "active" : "")
                  }
                  aria-current={activeView === next ? "page" : undefined}
                  aria-label={label(next)}
                  onClick={() => onNavigate(next)}
                  draggable={!collapsed}
                  onDragStart={() => onDragNavigation(next)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => onMoveNavigation(next)}
                  title={collapsed ? label(next) : undefined}
                >
                  <GripVertical
                    className="nav-drag-handle"
                    size={14}
                    aria-hidden="true"
                  />
                  <Icon size={18} />
                  <span>{label(next)}</span>
                  {next === "tasks" && (
                    <span className="nav-count">{taskCount}</span>
                  )}
                  {next === "notes" && (
                    <span className="nav-count">{noteCount}</span>
                  )}
                </button>
              ))}
          </section>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button
          ref={menuAnchor}
          className={"nav-item " + (activeView === "settings" ? "active" : "")}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={t("workspaceMenu")}
          aria-expanded={menuOpen}
          title={collapsed ? t("workspaceMenu") : undefined}
        >
          <Settings2 size={18} />
          <span>{t("workspaceMenu")}</span>
        </button>
        {menuOpen && (
          <AnchoredFloatingSurface
            anchorRef={menuAnchor}
            onDismiss={() => setMenuOpen(false)}
            className="workspace-menu"
            label={t("workspaceMenu")}
          >
            {(["account", "admin", "settings", "trash"] as const)
              .filter((next) => next !== "admin" || canAdmin)
              .map((next) => (
                <button
                  type="button"
                  role="menuitem"
                  key={next}
                  onClick={() => {
                    onNavigate(next);
                    setMenuOpen(false);
                  }}
                >
                  {label(next)}
                </button>
              ))}
            <button type="button" role="menuitem" onClick={onLogout}>
              <LogOut size={16} />
              {t("lock")}
            </button>
          </AnchoredFloatingSurface>
        )}
      </div>
    </aside>
  );
}
