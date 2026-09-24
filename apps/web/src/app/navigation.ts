import {
  BookOpen,
  CalendarDays,
  FolderKanban,
  GitBranch,
  Layers2,
  LayoutDashboard,
  ListTodo,
  NotebookPen,
  ShieldCheck,
  Target,
  Trash2,
} from "lucide-react";

export type View =
  | "library"
  | "account"
  | "admin"
  | "knowledge"
  | "ai"
  | "overview"
  | "focus"
  | "tasks"
  | "projects"
  | "calendar"
  | "dependencies"
  | "notes"
  | "journal"
  | "trash"
  | "settings";
export const navigation = [
  { view: "library", icon: BookOpen },
  { view: "account", icon: ShieldCheck },
  { view: "admin", icon: LayoutDashboard },
  { view: "knowledge", icon: Layers2 },
  { view: "ai", icon: ShieldCheck },
  { view: "overview", icon: LayoutDashboard },
  { view: "focus", icon: Target },
  { view: "tasks", icon: ListTodo },
  { view: "projects", icon: FolderKanban },
  { view: "calendar", icon: CalendarDays },
  { view: "dependencies", icon: GitBranch },
  { view: "notes", icon: BookOpen },
  { view: "journal", icon: NotebookPen },
  { view: "trash", icon: Trash2 },
] as const;
export type NavigationView = (typeof navigation)[number]["view"];
export const SIDEBAR_COLLAPSED_KEY = "orivane-atlas.sidebar-collapsed";
export function currentView(): View {
  const hash = location.hash.slice(1).split(/[/?]/)[0] ?? "";
  if (hash === "planning" || hash === "board") {
    history.replaceState(
      null,
      "",
      hash === "planning" ? "#tasks?tab=all" : "#tasks?view=board",
    );
    return "tasks";
  }
  return [...navigation.map((n) => n.view), "settings"].includes(hash)
    ? (hash as View)
    : "overview";
}
