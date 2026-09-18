import type { EntityRef, Note, OrganizeInput } from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  inheritedArchiveSource,
  isExecutionActive,
  isGloballyActiveTask,
  isReady,
  priorities,
  projectDescendants,
  type WorkItem,
  type WorkStatus,
  workStatuses,
} from "@arclattice/domain";
import { type LocalePreference, resolveLocale } from "@arclattice/i18n";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCheck,
  Columns3,
  Download,
  FolderKanban,
  GitBranch,
  GripVertical,
  Layers2,
  LayoutDashboard,
  ListTodo,
  LogOut,
  NotebookPen,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Target,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountView, AdminView } from "./AccountViews";
import { AppUpdater } from "./AppUpdater";
import {
  type Runtime,
  readPreference,
  type Snapshot,
  savePreference,
} from "./bootstrap";
import { AiView, KnowledgeView } from "./ConnectedViews";
import { DensitySettings } from "./DensitySettings";
import { type DocumentRequest, DocumentWorkspace } from "./DocumentWorkspace";
import { GraphCanvas } from "./GraphCanvas";
import { LibraryView } from "./LibraryView";
import { Login } from "./Login";
import { PrivateImageContext } from "./Markdown";
import { downloadText } from "./NoteEditor";
import { CalendarView, ProjectView } from "./PlanningViews";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { TaskEditor } from "./TaskEditor";
import { WorkflowManager } from "./WorkflowManager";
import { Dependencies, TaskList, WorkBoard } from "./WorkViews";

type View =
  | "library"
  | "account"
  | "admin"
  | "knowledge"
  | "ai"
  | "overview"
  | "focus"
  | "tasks"
  | "planning"
  | "board"
  | "projects"
  | "calendar"
  | "dependencies"
  | "notes"
  | "journal"
  | "trash"
  | "settings";
const navigation = [
  { view: "library", icon: BookOpen },
  { view: "account", icon: ShieldCheck },
  { view: "admin", icon: LayoutDashboard },
  { view: "knowledge", icon: Layers2 },
  { view: "ai", icon: ShieldCheck },
  { view: "overview", icon: LayoutDashboard },
  { view: "focus", icon: Target },
  { view: "tasks", icon: ListTodo },
  { view: "planning", icon: FolderKanban },
  { view: "board", icon: Columns3 },
  { view: "projects", icon: FolderKanban },
  { view: "calendar", icon: CalendarDays },
  { view: "dependencies", icon: GitBranch },
  { view: "notes", icon: BookOpen },
  { view: "journal", icon: NotebookPen },
  { view: "trash", icon: Trash2 },
] as const;
type NavigationView = (typeof navigation)[number]["view"];
const NAVIGATION_ORDER_KEY = "orivane-atlas.navigation-order";
const SIDEBAR_COLLAPSED_KEY = "orivane-atlas.sidebar-collapsed";
function currentView(): View {
  const hash = location.hash.slice(1);
  return [...navigation.map((n) => n.view), "settings"].includes(hash)
    ? (hash as View)
    : "overview";
}
function localDay() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}
export function App({ runtime }: { runtime: Runtime }) {
  const [context, setContext] = useState(runtime.context);
  return context ? (
    <PrivateImageContext.Provider
      value={runtime.native ? runtime.loadImage : null}
    >
      <Workbench
        runtime={runtime}
        context={context}
        onLogout={() => {
          runtime.context = null;
          setContext(null);
        }}
      />
    </PrivateImageContext.Provider>
  ) : (
    <>
      <Login runtime={runtime} onLogin={() => setContext(runtime.context)} />
      <AppUpdater updates={runtime.updates} />
    </>
  );
}
function Workbench({
  runtime,
  context,
  onLogout,
}: {
  runtime: Runtime;
  context: ActorContext;
  onLogout: () => void;
}) {
  const { t, i18n } = useTranslation([
    "desk",
    "common",
    "work",
    "settings",
    "errors",
  ]);
  const { t: a } = useTranslation("spaces");
  const viewLabel = (value: string) =>
    [
      "library",
      "account",
      "admin",
      "libraryHint",
      "accountHint",
      "adminHint",
    ].includes(value)
      ? a(value)
      : t(value);
  const [view, setView] = useState<View>(currentView);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [creation, setCreation] = useState<{
    type: "TASK" | "PROJECT";
    parentId: string;
  }>({ type: "TASK", parentId: "" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [navigationOrder, setNavigationOrder] = useState<NavigationView[]>(
    () => {
      const fallback = navigation.map((item) => item.view);
      try {
        const saved = JSON.parse(
          localStorage.getItem(NAVIGATION_ORDER_KEY) ?? "null",
        );
        if (!Array.isArray(saved)) return fallback;
        return [
          ...saved.filter((value): value is NavigationView =>
            fallback.includes(value),
          ),
          ...fallback.filter((value) => !saved.includes(value)),
        ];
      } catch {
        return fallback;
      }
    },
  );
  const [draggedNavigation, setDraggedNavigation] =
    useState<NavigationView | null>(null);
  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* best effort UI preference */
      }
      return next;
    });
  }
  function moveNavigation(target: NavigationView) {
    if (!draggedNavigation || draggedNavigation === target) return;
    setNavigationOrder((current) => {
      const next = [...current];
      const from = next.indexOf(draggedNavigation);
      const to = next.indexOf(target);
      if (from < 0 || to < 0) return current;
      next.splice(from, 1);
      next.splice(to, 0, draggedNavigation);
      try {
        localStorage.setItem(NAVIGATION_ORDER_KEY, JSON.stringify(next));
      } catch {
        /* best effort UI preference */
      }
      return next;
    });
    setDraggedNavigation(null);
  }
  const libraryDraft = useRef(false);
  const [documentRequest, setDocumentRequest] =
    useState<DocumentRequest | null>(null);
  const [documentVisible, setDocumentVisible] = useState(false);
  const [documentDirty, setDocumentDirty] = useState(false);
  function openDocument(request: DocumentRequest) {
    setDocumentRequest(request);
    setDocumentVisible(true);
  }
  const [snapshot, setSnapshot] = useState<Snapshot>({
    projectMaterials: [],
    items: [],
    edges: [],
    notes: [],
    links: [],
    library: [],
    organization: [],
  });
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [moveFolder, setMoveFolder] = useState("");
  const organization = (kind: "WORK" | "NOTE", id: string) =>
    snapshot.organization?.find((e) => e.kind === kind && e.id === id);
  const explicitlyArchived = (item: WorkItem) =>
    organization("WORK", item.id)?.archived ?? false;
  const archiveSource = (item: WorkItem) =>
    inheritedArchiveSource(item, snapshot.items, explicitlyArchived);
  const isArchived = (item: WorkItem) =>
    explicitlyArchived(item) || !!archiveSource(item);
  async function organize(input: OrganizeInput) {
    if (documentDirty || libraryDraft.current) {
      window.alert(t("saveBeforeOrganize"));
      return;
    }
    if (
      input.action === "delete" &&
      !window.confirm(t("confirmBulkDelete", { count: input.entries.length }))
    )
      return;
    if (await run(() => runtime.organize(input))) setSelectedNotes([]);
  }
  const [status, setStatus] = useState(() =>
    currentView() === "tasks" ? "UNFINISHED" : "ALL",
  );
  const [activationFilter, setActivationFilter] = useState("ALL");
  const [priority, setPriority] = useState("ALL");
  const [sort, setSort] = useState("updated");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [editor, setEditor] = useState<WorkItem | "new" | null>(null);
  const [noteEditor, setNoteEditor] = useState<
    Note | "NOTE" | "JOURNAL" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!noteEditor) return;
    const entity = typeof noteEditor === "string" ? undefined : noteEditor;
    const kind = entity?.kind ?? (noteEditor as "NOTE" | "JOURNAL");
    const date = entity?.day ?? localDay();
    openDocument({
      key:
        entity?.id ??
        (kind === "JOURNAL" ? "journal-" + date : crypto.randomUUID()),
      kind,
      entity,
      day: kind === "JOURNAL" ? date : undefined,
    });
    setNoteEditor(null);
  }, [noteEditor]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncOffline, setSyncOffline] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preference, setPreference] =
    useState<LocalePreference>(readPreference);
  const search = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const { service } = runtime;
  function errorCode(cause: unknown) {
    return cause instanceof DomainError ? String(cause.code) : "UNAVAILABLE";
  }
  async function refresh() {
    try {
      setSnapshot(await runtime.snapshot());
      setSyncOffline(false);
      setError(null);
    } catch (cause) {
      setError(errorCode(cause));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void runtime
      .snapshot()
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((cause) => {
        if (active) setError(errorCode(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [runtime]);
  useEffect(() => {
    let active = true,
      polling = false;
    const poll = async () => {
      if (document.hidden || polling) return;
      polling = true;
      try {
        const value = await runtime.snapshot();
        if (active) {
          setSnapshot(value);
          setSyncOffline(false);
        }
      } catch {
        if (active) setSyncOffline(true);
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    const foreground = () => void poll();
    window.addEventListener("online", foreground);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", foreground);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [runtime]);
  useEffect(() => {
    const listener = () => {
      if (libraryDraft.current && !window.confirm(a("leave"))) {
        history.replaceState(null, "", "#library");
        return;
      }
      libraryDraft.current = false;
      setView(currentView());
      setDocumentVisible(false);
      setQuery("");
      setStatus(currentView() === "tasks" ? "UNFINISHED" : "ALL");
      setActivationFilter("ALL");
      setPriority("ALL");
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, [a]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        editor ||
        noteEditor ||
        busy ||
        loading ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target as HTMLElement).isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (event.target as HTMLElement).tagName,
        )
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.key === "n") {
        event.preventDefault();
        setError(null);
        if (view === "notes") setNoteEditor("NOTE");
        else if (view !== "journal") open("new");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [editor, noteEditor, busy, loading, view]);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (operation.current) return false;
    operation.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await action();
      setSaved(true);
      await refresh();
      return true;
    } catch (cause) {
      setError(errorCode(cause));
      return false;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  // A successful mutation is committed even if its following refresh fails. Do not resubmit a create.
  const errorMessage = error
    ? t("errors:" + error, { defaultValue: t("connectionError") })
    : null;
  const allItems = snapshot.items.filter((item) => !item.deletedAt);
  const projects = allItems.filter((item) => item.type === "PROJECT");
  const items = allItems.filter(
    (item) => item.type !== "PROJECT" && !isArchived(item),
  );
  const notes = snapshot.notes.filter((note) => !note.deletedAt);
  const [utcDay, setUtcDay] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  useEffect(() => {
    const update = () => setUtcDay(new Date().toISOString().slice(0, 10));
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const ready = items.filter((item) =>
    isReady(item, allItems, snapshot.edges, utcDay),
  );
  const active = items.filter(
    (item) => item.status === "IN_PROGRESS" && isExecutionActive(item, utcDay),
  );
  const done = items.filter((item) => item.status === "DONE");
  const matches = (title: string, body: string) =>
    (title + " " + body)
      .toLocaleLowerCase(i18n.language)
      .includes(query.toLocaleLowerCase(i18n.language));
  const selectedProject = projects.find((p) => p.id === projectFilter);
  const projectMemberIds = new Set(
    selectedProject
      ? projectDescendants(selectedProject, allItems).map((i) => i.id)
      : [],
  );
  const visible = (
    showArchived
      ? allItems.filter((item) => item.type !== "PROJECT" && isArchived(item))
      : items
  )
    .filter(
      (item) =>
        item.type === "TASK" &&
        (!["tasks", "board"].includes(view) ||
          isExecutionActive(item, utcDay)) &&
        (view !== "planning" ||
          activationFilter === "ALL" ||
          isExecutionActive(item, utcDay) ===
            (activationFilter === "ACTIVE")) &&
        matches(item.title, item.descriptionMd) &&
        (status === "ALL" ||
          (status === "UNFINISHED"
            ? ["TODO", "IN_PROGRESS"].includes(item.status)
            : item.status === status)) &&
        (priority === "ALL" || item.priority === priority) &&
        (projectFilter === "ALL" ||
          (projectFilter === "NONE"
            ? !item.projectId
            : projectMemberIds.has(item.id))),
    )
    .sort((a, b) =>
      sort === "priority"
        ? priorities.indexOf(b.priority) - priorities.indexOf(a.priority)
        : sort === "title"
          ? a.title.localeCompare(b.title, i18n.language)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const focus = [
    ...active,
    ...ready.filter((item) => !active.some((a) => a.id === item.id)),
  ];
  const day = localDay();
  const count = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  function navigate(next: View) {
    setDocumentVisible(false);
    if (libraryDraft.current && !window.confirm(a("leave"))) return;
    libraryDraft.current = false;
    location.hash = next;
    setView(next);
    setSelectedNotes([]);
    setShowArchived(false);
    setFolderFilter(null);
    setQuery("");
    setStatus(next === "tasks" ? "UNFINISHED" : "ALL");
    setActivationFilter("ALL");
    setPriority("ALL");
    setSaved(false);
  }
  function open(item: WorkItem | "new") {
    setError(null);
    if (item === "new")
      setCreation({
        type: view === "projects" ? "PROJECT" : "TASK",
        parentId: "",
      });
    setEditor(item);
  }
  function openEntity(ref: EntityRef) {
    if (ref.kind === "WORK") {
      const item = snapshot.items.find((entry) => entry.id === ref.id);
      if (item) open(item);
    } else if (ref.kind === "NOTE") {
      const note = snapshot.notes.find((entry) => entry.id === ref.id);
      if (note) openNote(note);
    } else {
      const entity = snapshot.library.find((entry) => entry.id === ref.id);
      if (entity)
        openDocument({
          key: entity.id,
          kind: entity.kind,
          entity,
          spaceId: entity.spaceId,
        });
    }
  }
  function openNote(note: Note | "NOTE" | "JOURNAL") {
    setError(null);
    setNoteEditor(note);
  }
  function create() {
    if (view === "notes") openNote("NOTE");
    else if (view === "journal")
      openNote(
        notes.find((n) => n.kind === "JOURNAL" && n.day === day) ??
          snapshot.notes
            .filter((n) => n.kind === "JOURNAL" && n.day === day)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
          "JOURNAL",
      );
    else open("new");
  }
  const onStatus = (item: WorkItem, next: WorkStatus) =>
    run(() => service.update(context, item.id, item.version, { status: next }));
  const workProps = {
    today: utcDay,
    allItems,
    edges: snapshot.edges,
    busy,
    onOpen: open,
    onStatus,
    isArchived,
    archiveSource,
    onOrganize: (
      item: WorkItem,
      action: "archive" | "unarchive" | "delete",
    ) => {
      void organize({
        kind: "WORK",
        action,
        entries: [
          {
            id: item.id,
            version: item.version,
            organizationVersion: organization("WORK", item.id)?.version ?? 0,
          },
        ],
      });
    },
  };
  async function switchLanguage(value: LocalePreference) {
    setPreference(value);
    savePreference(value);
    const locale = resolveLocale(value, navigator.language);
    await i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }
  const noteCards = (allEntries: Note[]) => {
    const entries = allEntries.filter(
      (n) =>
        folderFilter === null ||
        (organization("NOTE", n.id)?.folder ?? "") === folderFilter,
    );
    return (
      <>
        <div className="organization-toolbar">
          <label>
            <input
              type="checkbox"
              aria-label={t("selectVisible")}
              checked={
                entries.length > 0 &&
                entries.every((n) => selectedNotes.includes(n.id))
              }
              disabled={busy || entries.length > 100}
              onChange={(e) =>
                setSelectedNotes(
                  e.target.checked ? entries.map((n) => n.id) : [],
                )
              }
            />
            {t("selectVisible")}
          </label>
          <span>{t("selectionCount", { count: selectedNotes.length })}</span>
          <button
            type="button"
            className="button secondary"
            disabled={!selectedNotes.length || busy}
            onClick={() => setSelectedNotes([])}
          >
            {t("clearSelection")}
          </button>
          <label>
            {t("folder")}
            <select
              aria-label={t("folderFilter")}
              value={folderFilter === null ? "all" : "folder:" + folderFilter}
              onChange={(e) => {
                setFolderFilter(
                  e.target.value === "all" ? null : e.target.value.slice(7),
                );
                setSelectedNotes([]);
              }}
            >
              <option value="all">{t("allFolders")}</option>
              <option value="folder:">{t("unfiled")}</option>
              {[
                ...new Set(
                  notes
                    .map((n) => organization("NOTE", n.id)?.folder ?? "")
                    .filter(Boolean),
                ),
              ]
                .sort()
                .map((folder) => (
                  <option key={folder} value={"folder:" + folder}>
                    {folder}
                  </option>
                ))}
            </select>
          </label>
          {selectedNotes.length > 0 && (
            <>
              <input
                aria-label={t("destinationFolder")}
                placeholder={t("destinationFolder")}
                value={moveFolder}
                maxLength={80}
                onChange={(e) => setMoveFolder(e.target.value)}
              />
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void organize({
                    kind: "NOTE",
                    action: "move",
                    folder: moveFolder,
                    entries: notes
                      .filter((n) => selectedNotes.includes(n.id))
                      .map((n) => ({
                        id: n.id,
                        version: n.version,
                        organizationVersion:
                          organization("NOTE", n.id)?.version ?? 0,
                      })),
                  })
                }
              >
                {t("moveSelected")}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void organize({
                    kind: "NOTE",
                    action: "delete",
                    entries: notes
                      .filter((n) => selectedNotes.includes(n.id))
                      .map((n) => ({
                        id: n.id,
                        version: n.version,
                        organizationVersion:
                          organization("NOTE", n.id)?.version ?? 0,
                      })),
                  })
                }
              >
                {t("deleteSelected")}
              </button>
            </>
          )}
        </div>
        <div className="note-grid">
          {entries
            .filter(
              (n) =>
                folderFilter === null ||
                (organization("NOTE", n.id)?.folder ?? "") === folderFilter,
            )
            .map((note) => (
              <article className="selectable-note" key={note.id}>
                <label className="note-selection">
                  <input
                    type="checkbox"
                    aria-label={t("selectNote", { title: note.title })}
                    checked={selectedNotes.includes(note.id)}
                    disabled={
                      busy ||
                      (!selectedNotes.includes(note.id) &&
                        selectedNotes.length >= 100)
                    }
                    onChange={(e) =>
                      setSelectedNotes((old) =>
                        e.target.checked
                          ? [...old, note.id]
                          : old.filter((id) => id !== note.id),
                      )
                    }
                  />
                  <span>
                    {organization("NOTE", note.id)?.folder || t("unfiled")}
                  </span>
                </label>
                <button
                  type="button"
                  className="note-card"
                  key={note.id}
                  onClick={() => openNote(note)}
                >
                  <div className="note-card-top">
                    {note.kind === "JOURNAL" ? (
                      <NotebookPen size={18} />
                    ) : (
                      <BookOpen size={18} />
                    )}
                    <span>{note.day ?? date(note.updatedAt)}</span>
                  </div>
                  <h3>{note.title}</h3>
                  <p>{note.bodyMd.slice(0, 180) || t("emptyNote")}</p>
                  <footer>
                    <span>{t("private")}</span>
                    <ArrowUpRight size={16} />
                  </footer>
                </button>
              </article>
            ))}
        </div>
      </>
    );
  };
  return (
    <div
      className={
        "app-shell " +
        (sidebarCollapsed ? "sidebar-collapsed " : "") +
        (mobileNavigationOpen
          ? "mobile-navigation-open"
          : "mobile-navigation-closed")
      }
    >
      <aside className="sidebar" id="workspace-sidebar">
        <div className="brand">
          <img
            className="brand-logo"
            src="/orivane-atlas.png"
            alt="Orivane Atlas"
          />
        </div>
        <button
          type="button"
          className="icon-button mobile-navigation-toggle"
          aria-label={t(
            mobileNavigationOpen ? "collapseSidebar" : "expandSidebar",
          )}
          aria-expanded={mobileNavigationOpen}
          aria-controls="workspace-navigation"
          onClick={() => setMobileNavigationOpen((value) => !value)}
        >
          <PanelLeft size={20} />
        </button>
        <div className="workspace-switch">
          <span className="workspace-avatar">A</span>
          <div>
            <strong>{t("personal")}</strong>
            <small>{t("privateWorkspace")}</small>
          </div>
        </div>
        <nav id="workspace-navigation" aria-label={t("workspace")}>
          <p className="section-label">{t("workspace")}</p>
          {navigationOrder
            .map((next) => navigation.find((item) => item.view === next)!)
            .filter(Boolean)
            .filter(
              (n) =>
                n.view !== "admin" ||
                !runtime.account ||
                runtime.account.role === "ADMIN",
            )
            .map(({ view: next, icon: Icon }) => (
              <button
                type="button"
                key={next}
                className={"nav-item " + (view === next ? "active" : "")}
                aria-current={view === next ? "page" : undefined}
                aria-label={viewLabel(next)}
                onClick={() => navigate(next)}
                draggable
                onDragStart={() => setDraggedNavigation(next)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveNavigation(next)}
                title={sidebarCollapsed ? viewLabel(next) : undefined}
              >
                <GripVertical
                  className="nav-drag-handle"
                  size={14}
                  aria-hidden="true"
                />
                <Icon size={18} />
                <span>{viewLabel(next)}</span>
                {next === "tasks" && (
                  <span className="nav-count">
                    {count(
                      items.filter((item) => isGloballyActiveTask(item, utcDay))
                        .length,
                    )}
                  </span>
                )}
                {next === "notes" && (
                  <span className="nav-count">
                    {count(notes.filter((n) => n.kind === "NOTE").length)}
                  </span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="storage-card">
            <ShieldCheck size={18} />
            <strong>{t("protected")}</strong>
            <p>{t("remoteHint")}</p>
          </div>
          <button
            className={"nav-item " + (view === "settings" ? "active" : "")}
            type="button"
            onClick={() => navigate("settings")}
            aria-label={t("settings")}
          >
            <Settings2 size={18} />
            <span>{t("settings")}</span>
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{t("personal")}</span>
            <span>/</span>
            <strong>{viewLabel(view)}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button sidebar-toggle"
              type="button"
              aria-label={
                sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")
              }
              aria-expanded={!sidebarCollapsed}
              aria-controls="workspace-sidebar"
              onClick={toggleSidebar}
            >
              <PanelLeft size={17} />
            </button>
            <span
              className={
                "mode-badge " + (error || syncOffline ? "offline" : "")
              }
              title={t(
                view === "library" || view === "account" || view === "admin"
                  ? "spaces:refresh"
                  : "connected:syncHint",
              )}
            >
              <span />
              {loading
                ? t("connecting")
                : syncOffline
                  ? t("connected:offline")
                  : error
                    ? t("attention")
                    : busy
                      ? t("saving")
                      : saved
                        ? t("saved")
                        : view === "library" ||
                            view === "account" ||
                            view === "admin"
                          ? t("spaces:connected")
                          : t("connected:synced")}
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label={t("refresh")}
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            {!(
              [
                "settings",
                "trash",
                "knowledge",
                "ai",
                "library",
                "account",
                "admin",
              ] as string[]
            ).includes(view) && (
              <button
                className="button primary compact-create"
                type="button"
                disabled={busy || loading}
                onClick={create}
              >
                <Plus size={17} />
                {t(
                  view === "notes"
                    ? "newNote"
                    : view === "journal"
                      ? "todayJournal"
                      : view === "projects"
                        ? "newProject"
                        : "newTask",
                )}
              </button>
            )}
          </div>
        </header>
        <DocumentWorkspace
          request={documentRequest}
          visible={documentVisible}
          runtime={runtime}
          snapshot={snapshot}
          onDirty={setDocumentDirty}
          onChange={() => void refresh()}
          onBrowse={() => setDocumentVisible(false)}
          onVisibility={() => setDocumentVisible(true)}
        />
        <div className="content" hidden={documentVisible}>
          {errorMessage && !editor && !noteEditor && (
            <div className="error" role="alert">
              {errorMessage}
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void refresh()}
              >
                {t("refresh")}
              </button>
              {error === "UNAUTHORIZED" && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={onLogout}
                >
                  {t("unlock")}
                </button>
              )}
            </div>
          )}
          <div
            className="settings-panel"
            hidden={view !== "settings" || loading}
          >
            <DensitySettings
              actor={context}
              controls={view === "settings" && !loading}
            />
          </div>
          {loading ? (
            <div className="loading-panel" role="status">
              {t("connecting")}
            </div>
          ) : view === "library" ? (
            <LibraryView runtime={runtime} onOpen={openDocument} />
          ) : view === "account" ? (
            <AccountView
              runtime={runtime}
              onLogout={onLogout}
              confirmLeave={() =>
                !(documentDirty || libraryDraft.current || editor) ||
                window.confirm(t("discardHint"))
              }
            />
          ) : view === "admin" ? (
            <AdminView runtime={runtime} />
          ) : view === "knowledge" ? (
            <KnowledgeView
              snapshot={snapshot}
              busy={busy}
              onLink={(from, to, relation) =>
                run(() => runtime.link(from, to, relation))
              }
              onUnlink={(link) =>
                run(() => runtime.unlink(link.id, link.version))
              }
              onOpen={(ref) => {
                if (ref.kind === "NOTE") {
                  const note = snapshot.notes.find((n) => n.id === ref.id);
                  if (note) setNoteEditor(note);
                } else if (ref.kind === "SPACE" || ref.kind === "DOCUMENT") {
                  const entity = snapshot.library.find((e) => e.id === ref.id);
                  if (entity)
                    openDocument({
                      key: entity.id,
                      kind: entity.kind,
                      entity,
                      spaceId: entity.spaceId,
                    });
                } else {
                  const item = snapshot.items.find((i) => i.id === ref.id);
                  if (item) setEditor(item);
                }
              }}
            />
          ) : view === "ai" ? (
            <AiView runtime={runtime} snapshot={snapshot} />
          ) : view === "overview" ? (
            <>
              <div className="metric-grid">
                {[
                  {
                    label: "openTasks",
                    value: items.filter(
                      (i) => !["DONE", "CANCELED"].includes(i.status),
                    ).length,
                    icon: ListTodo,
                    next: "tasks",
                  },
                  {
                    label: "readyNow",
                    value: ready.length,
                    icon: Target,
                    next: "focus",
                  },
                  {
                    label: "completed",
                    value: done.length,
                    icon: CheckCheck,
                    next: "board",
                  },
                  {
                    label: "savedNotes",
                    value: notes.length,
                    icon: BookOpen,
                    next: "notes",
                  },
                ].map(({ label, value, icon: Icon, next }) => (
                  <button
                    className="metric-card"
                    type="button"
                    key={label}
                    onClick={() => navigate(next as View)}
                  >
                    <div>
                      <span>{t(label)}</span>
                      <Icon size={18} />
                    </div>
                    <strong>{count(value)}</strong>
                    <small>
                      {t("viewDetails")}
                      <ArrowUpRight size={13} />
                    </small>
                  </button>
                ))}
              </div>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">{t("nextStep")}</p>
                      <h2>{t("focus")}</h2>
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => navigate("focus")}
                    >
                      {t("viewAll")}
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {focus.length ? (
                    <TaskList items={focus.slice(0, 5)} {...workProps} />
                  ) : (
                    <div className="empty-state compact">
                      <Target size={30} />
                      <h3>{t("focusEmpty")}</h3>
                      <p>{t("focusEmptyHint")}</p>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => open("new")}
                      >
                        {t("newTask")}
                      </button>
                    </div>
                  )}
                </section>
                <section className="today-panel">
                  <span className="eyebrow">{t("dailySpace")}</span>
                  <NotebookPen size={30} />
                  <h2>{t("journalPrompt")}</h2>
                  <p>{t("journalPromptHint")}</p>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() =>
                      openNote(
                        notes.find(
                          (n) => n.kind === "JOURNAL" && n.day === day,
                        ) ?? "JOURNAL",
                      )
                    }
                  >
                    {t("todayJournal")}
                    <ArrowUpRight size={16} />
                  </button>
                  <div className="progress-label">
                    <span>{t("completion")}</span>
                    <strong>
                      {items.length
                        ? Math.round((done.length / items.length) * 100)
                        : 0}
                      %
                    </strong>
                  </div>
                  <progress
                    max={Math.max(items.length, 1)}
                    value={done.length}
                  />
                </section>
              </div>
              <section className="recent-notes">
                <div className="panel-heading">
                  <h2>{t("recentNotes")}</h2>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => navigate("notes")}
                  >
                    {t("viewAll")}
                    <ArrowUpRight size={15} />
                  </button>
                </div>
                {notes.length ? (
                  noteCards(
                    [...notes]
                      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                      .slice(0, 3),
                  )
                ) : (
                  <button
                    className="note-empty"
                    type="button"
                    onClick={() => openNote("NOTE")}
                  >
                    <BookOpen size={22} />
                    <span>{t("firstNote")}</span>
                    <Plus size={18} />
                  </button>
                )}
              </section>
            </>
          ) : view === "projects" ? (
            <>
              {projects.find((project) => project.id === activeProjectId) ? (
                <ProjectWorkspace
                  runtime={runtime}
                  run={run}
                  key={activeProjectId}
                  project={
                    projects.find((project) => project.id === activeProjectId)!
                  }
                  snapshot={snapshot}
                  busy={busy}
                  onBack={() => setActiveProjectId(null)}
                  onProject={setActiveProjectId}
                  onOpen={openEntity}
                  onCreate={(type, parentId) => {
                    setCreation({ type, parentId });
                    setError(null);
                    setEditor("new");
                  }}
                  onLink={(from, to) =>
                    run(() => runtime.link(from, to, "REFERENCES"))
                  }
                  onUnlink={(link) =>
                    run(() => runtime.unlink(link.id, link.version))
                  }
                  onAddEdge={(from, to) =>
                    run(() => service.addEdge(context, from, to))
                  }
                  onRemoveEdge={(id) =>
                    run(() => service.removeEdge(context, id))
                  }
                />
              ) : (
                <>
                  <ProjectView
                    categories={snapshot.categories ?? []}
                    onSaveCategory={(input) =>
                      run(() => runtime.saveCategory(input))
                    }
                    projects={projects}
                    items={allItems}
                    busy={busy}
                    isArchived={isArchived}
                    archiveSource={archiveSource}
                    onOrganize={workProps.onOrganize}
                    onOpen={(project) => setActiveProjectId(project.id)}
                    onTasks={(id) => {
                      navigate("tasks");
                      setProjectFilter(id);
                      const project = projects.find((p) => p.id === id);
                      setShowArchived(!!project && isArchived(project));
                    }}
                  />
                  <WorkflowManager
                    records={snapshot.workflows ?? []}
                    projects={projects}
                    busy={busy}
                    preview={(projectId, manifest) =>
                      run(() => runtime.previewPlan(projectId, manifest))
                    }
                    publish={(id, version) =>
                      run(() => runtime.publishPlan(id, version))
                    }
                    save={(input) => run(() => runtime.saveRecurrence(input))}
                    generate={(id, version, from, to) =>
                      run(() =>
                        runtime.generateRecurrence(id, version, from, to),
                      )
                    }
                    backfill={(id, version, completedAt) =>
                      run(() =>
                        runtime.backfillOccurrence(id, version, completedAt),
                      )
                    }
                  />
                </>
              )}
            </>
          ) : view === "calendar" ? (
            <CalendarView
              items={items}
              today={day}
              onOpen={open}
              journals={snapshot.notes}
              onJournal={(date) => {
                const entity =
                  snapshot.notes.find(
                    (n) =>
                      n.kind === "JOURNAL" && n.day === date && !n.deletedAt,
                  ) ??
                  snapshot.notes
                    .filter((n) => n.kind === "JOURNAL" && n.day === date)
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                openDocument({
                  key: entity?.id ?? "journal-" + date,
                  kind: "JOURNAL",
                  entity,
                  day: date,
                });
              }}
            />
          ) : view === "settings" ? (
            <div className="settings-panel">
              <AppUpdater updates={runtime.updates} />
              <section>
                <h2>{t("settings:language")}</h2>
                <p>{t("settings:languageHint")}</p>
                <label className="field">
                  <span>{t("settings:language")}</span>
                  <select
                    aria-label={t("settings:language")}
                    value={preference}
                    onChange={(event) =>
                      void switchLanguage(
                        event.target.value as LocalePreference,
                      )
                    }
                  >
                    <option value="system">{t("settings:system")}</option>
                    <option value="en-US">English</option>
                    <option value="zh-CN">简体中文</option>
                  </select>
                </label>
              </section>
              <section>
                <h2>{t("dataControl")}</h2>
                {runtime.account?.role === "USER" ? (
                  <p>{t("spaces:backupAdmin")}</p>
                ) : (
                  <>
                    <p>{t("backupHint")}</p>
                    <button
                      className="button primary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const blob = await runtime.backup();
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement("a");
                          link.href = url;
                          link.download = "arclattice-" + day + ".sqlite";
                          link.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        })
                      }
                    >
                      <Download size={17} />
                      {t("backupDatabase")}
                    </button>
                  </>
                )}
                <p>{t("exportHint")}</p>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    downloadText(
                      "arclattice-" + day + ".json",
                      JSON.stringify(
                        {
                          format: "arclattice-workbench-snapshot",
                          version: 1,
                          exportedAt: new Date().toISOString(),
                          ...snapshot,
                        },
                        null,
                        2,
                      ),
                      "application/json",
                    )
                  }
                >
                  <Download size={17} />
                  {t("exportData")}
                </button>
              </section>
              <section>
                <h2>{t("protected")}</h2>
                <p>{t("scope")}</p>
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void (
                      (documentDirty || libraryDraft.current || editor) &&
                      !window.confirm(t("discardHint"))
                        ? Promise.resolve(false)
                        : run(() => runtime.logout())
                    ).then((ok) => {
                      if (ok) onLogout();
                    })
                  }
                >
                  <LogOut size={17} />
                  {t("lock")}
                </button>
              </section>
            </div>
          ) : view === "dependencies" ? (
            <>
              <GraphCanvas
                snapshot={snapshot}
                tasks
                onOpen={(ref) => {
                  const item = snapshot.items.find((i) => i.id === ref.id);
                  if (item) setEditor(item);
                }}
                onConnect={(from, to) =>
                  run(() => service.addEdge(context, from.id, to.id))
                }
                onRemove={(id) => run(() => service.removeEdge(context, id))}
              />
              <Dependencies
                items={allItems}
                edges={snapshot.edges}
                busy={busy}
                onAdd={(from, to) =>
                  run(() => service.addEdge(context, from, to))
                }
                onRemove={(id) => run(() => service.removeEdge(context, id))}
              />
            </>
          ) : (
            <>
              <div className="list-toolbar">
                <div className="view-count">
                  <h2>{t(view)}</h2>
                  <span>
                    {count(
                      view === "notes" || view === "journal"
                        ? notes.filter(
                            (n) =>
                              n.kind ===
                              (view === "notes" ? "NOTE" : "JOURNAL"),
                          ).length
                        : view === "trash"
                          ? snapshot.items.filter((i) => i.deletedAt).length +
                            snapshot.notes.filter((n) => n.deletedAt).length
                          : view === "focus"
                            ? focus.length
                            : visible.length,
                    )}
                  </span>
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    ref={search}
                    aria-label={t("search")}
                    placeholder={t("search")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <kbd>/</kbd>
                </label>
              </div>
              {["tasks", "board", "planning"].includes(view) && (
                <section className="task-query-panel">
                  <div className="task-scope-heading">
                    <p>
                      {t(
                        view === "planning"
                          ? "planningHint"
                          : "activeTasksHint",
                      )}
                    </p>
                    {view !== "planning" && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => navigate("planning")}
                      >
                        {t("manageActivation")}
                      </button>
                    )}
                  </div>
                  <div className="filter-bar">
                    {view === "planning" && (
                      <label>
                        <span>{t("activationState")}</span>
                        <select
                          aria-label={t("activationState")}
                          value={activationFilter}
                          onChange={(event) =>
                            setActivationFilter(event.target.value)
                          }
                        >
                          <option value="ALL">{t("all")}</option>
                          <option value="ACTIVE">
                            {t("activationStates.ACTIVE")}
                          </option>
                          <option value="INACTIVE">
                            {t("activationStates.INACTIVE")}
                          </option>
                        </select>
                      </label>
                    )}
                    <label>
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                      />
                      {t("showArchived")}
                    </label>
                    <label>
                      <span>{t("project")}</span>
                      <select
                        aria-label={t("project")}
                        value={projectFilter}
                        onChange={(event) =>
                          setProjectFilter(event.target.value)
                        }
                      >
                        <option value="ALL">{t("all")}</option>
                        <option value="NONE">{t("noProject")}</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t("status")}</span>
                      <select
                        aria-label={t("status")}
                        value={status}
                        onChange={(event) => setStatus(event.target.value)}
                      >
                        <option value="ALL">{t("all")}</option>
                        <option value="UNFINISHED">
                          {t("unfinishedTasks")}
                        </option>
                        {workStatuses.map((s) => (
                          <option key={s} value={s}>
                            {t("work:statuses." + s)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t("priority")}</span>
                      <select
                        aria-label={t("priority")}
                        value={priority}
                        onChange={(event) => setPriority(event.target.value)}
                      >
                        <option value="ALL">{t("all")}</option>
                        {priorities.map((p) => (
                          <option key={p} value={p}>
                            {t("work:priorities." + p)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="sort-control">
                      <span>{t("sort")}</span>
                      <select
                        aria-label={t("sort")}
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                      >
                        <option value="updated">{t("recentlyUpdated")}</option>
                        <option value="priority">{t("priority")}</option>
                        <option value="title">{t("title")}</option>
                      </select>
                    </label>
                  </div>
                </section>
              )}
              {view === "notes" || view === "journal" ? (
                (() => {
                  const entries = notes
                    .filter(
                      (n) =>
                        n.kind === (view === "notes" ? "NOTE" : "JOURNAL") &&
                        matches(n.title, n.bodyMd),
                    )
                    .sort((a, b) =>
                      (b.day ?? b.updatedAt).localeCompare(
                        a.day ?? a.updatedAt,
                      ),
                    );
                  return entries.length ? (
                    noteCards(entries)
                  ) : (
                    <div className="empty-state">
                      <BookOpen size={30} />
                      <h2>{t(query ? "noResults" : "captureThought")}</h2>
                      <p>{t("notesHint")}</p>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={create}
                      >
                        {t(view === "journal" ? "todayJournal" : "newNote")}
                      </button>
                    </div>
                  );
                })()
              ) : view === "trash" ? (
                <div className="trash-list">
                  {snapshot.items
                    .filter(
                      (i) => i.deletedAt && matches(i.title, i.descriptionMd),
                    )
                    .map((item) => (
                      <div key={item.id}>
                        <ListTodo size={18} />
                        <span>{item.title}</span>
                        <button
                          className="button secondary"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              service.setDeleted(
                                context,
                                item.id,
                                item.version,
                                false,
                              ),
                            )
                          }
                        >
                          {t("common:restore")}
                        </button>
                      </div>
                    ))}
                  {snapshot.notes
                    .filter((n) => n.deletedAt && matches(n.title, n.bodyMd))
                    .map((note) => (
                      <div key={note.id}>
                        <BookOpen size={18} />
                        <span>{note.title}</span>
                        <button
                          className="button secondary"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              runtime.deleteNote(note.id, note.version, false),
                            )
                          }
                        >
                          {t("common:restore")}
                        </button>
                      </div>
                    ))}
                  {!snapshot.items.some((i) => i.deletedAt) &&
                    !snapshot.notes.some((n) => n.deletedAt) && (
                      <p className="empty-small">{t("work:emptyTrash")}</p>
                    )}
                </div>
              ) : view === "focus" ? (
                focus.filter((i) => matches(i.title, i.descriptionMd))
                  .length ? (
                  <TaskList
                    items={focus.filter((i) =>
                      matches(i.title, i.descriptionMd),
                    )}
                    {...workProps}
                  />
                ) : (
                  <div className="empty-state">
                    <Target size={30} />
                    <h2>{t("focusEmpty")}</h2>
                    <p>{t("focusEmptyHint")}</p>
                  </div>
                )
              ) : view === "board" ? (
                <>
                  <p className="board-hint">{t("boardDragHint")}</p>
                  <WorkBoard items={visible} {...workProps} />
                </>
              ) : visible.length ? (
                <TaskList items={visible} {...workProps} />
              ) : (
                <div className="empty-state">
                  <ListTodo size={30} />
                  <h2>{t(items.length ? "noResults" : "firstTask")}</h2>
                  <p>{t("tasksHint")}</p>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => open("new")}
                  >
                    {t("newTask")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="workspace-footer">
          <span>Orivane Atlas · {t("privateWorkspace")}</span>
          <span>{t("footerHint")}</span>
        </footer>
      </main>
      {editor && (
        <TaskEditor
          key={editor === "new" ? "new" : editor.id + "-" + editor.version}
          item={editor === "new" ? null : editor}
          projects={projects}
          createType={creation.type}
          initialProjectId={creation.parentId}
          busy={busy}
          error={errorMessage}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            if (
              await run(() =>
                editor === "new"
                  ? service.create(context, {
                      ...input,
                      type: creation.type,
                    })
                  : service.update(context, editor.id, editor.version, input),
              )
            )
              setEditor(null);
          }}
          onDelete={
            editor === "new"
              ? null
              : async () => {
                  if (
                    await run(() =>
                      service.setDeleted(
                        context,
                        editor.id,
                        editor.version,
                        true,
                      ),
                    )
                  )
                    setEditor(null);
                }
          }
        />
      )}
    </div>
  );
}
