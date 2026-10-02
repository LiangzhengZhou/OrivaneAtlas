import type { EntityRef, Note, OrganizeInput } from "@arclattice/application";
import { privateContentPolicy } from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  defaultNavigationPreference,
  inheritedArchiveSource,
  localCalendarDay,
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
  CheckCheck,
  Download,
  ListTodo,
  LogOut,
  NotebookPen,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Target,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountView, AdminView } from "./AccountViews";
import { AppUpdater } from "./AppUpdater";
import { AppShell } from "./app/AppShell";
import { CommandPalette } from "./app/CommandPalette";
import { usePendingOperations } from "./app/hooks/usePendingOperations";
import { NavigationSettings } from "./app/NavigationSettings";
import {
  currentView,
  type NavigationView,
  navigation,
  SIDEBAR_COLLAPSED_KEY,
  type View,
} from "./app/navigation";
import { Sidebar } from "./app/Sidebar";
import { showToast, ToastHost } from "./app/ToastHost";
import { Topbar } from "./app/Topbar";
import { WorkspaceRouter } from "./app/WorkspaceRouter";
import {
  type Runtime,
  readPreference,
  type Snapshot,
  savePreference,
} from "./bootstrap";
import { CalendarSettings } from "./CalendarSettings";
import { KnowledgeView } from "./ConnectedViews";
import { DensitySettings } from "./DensitySettings";
import { type DocumentRequest, DocumentWorkspace } from "./DocumentWorkspace";
import { AiSettingsView } from "./features/ai/AiSettingsView";
import { AssistantPane } from "./features/ai/AssistantPane";
import { MoreSheet } from "./features/mobile/MoreSheet";
import { ProjectDependencyGraph } from "./features/projects/ProjectDependencyGraph";
import { ProjectDrilldownPicker } from "./features/projects/ProjectDrilldownPicker";
import { TasksWorkspace } from "./features/tasks/TasksWorkspace";
import { selectTasks } from "./features/tasks/task-selectors";
import { LibraryView } from "./LibraryView";
import { Login } from "./Login";
import { PrivateImageContext } from "./Markdown";
import { CalendarView, ProjectView } from "./PlanningViews";
import { ProjectWorkspace } from "./ProjectWorkspace";
import {
  type ProjectTab,
  parseProjectRoute,
  projectHash,
} from "./projectRoute";
import { ThemeSettings } from "./ThemeSettings";
import { downloadText } from "./utils/download";
import { WorkflowManager } from "./WorkflowManager";
import { WorkItemEditor } from "./WorkItemEditor";
import { Dependencies, TaskList } from "./WorkViews";

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
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => {
    const open = () => setAssistantOpen(true);
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "j"
      ) {
        event.preventDefault();
        setAssistantOpen((old) => !old);
      }
    };
    window.addEventListener("atlas:open", open);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("atlas:open", open);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  const [projectRoute, setProjectRoute] = useState(() =>
    parseProjectRoute(location.hash),
  );
  const activeProjectId = projectRoute.projectId;
  const acceptedHash = useRef(location.hash);
  const [creation, setCreation] = useState<{
    type: "TASK" | "PROJECT" | "MILESTONE";
    parentId: string;
  }>({ type: "TASK", parentId: "" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
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
    const order = [...navigationPreference.desktop.order];
    const from = order.indexOf(draggedNavigation);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    order.splice(to, 0, draggedNavigation);
    void run(() =>
      service.setNavigationPreference(context, {
        ...navigationPreference,
        desktop: { ...navigationPreference.desktop, order },
      }),
    );
    setDraggedNavigation(null);
  }
  const libraryDraft = useRef(false);
  const projectBriefDirty = useRef(false);
  const [documentRequest, setDocumentRequest] =
    useState<DocumentRequest | null>(null);
  const [documentVisible, setDocumentVisible] = useState(false);
  const [activeDocumentContext, setActiveDocumentContext] =
    useState<DocumentRequest | null>(null);
  const [documentDirty, setDocumentDirty] = useState(false);
  function openDocument(request: DocumentRequest) {
    setDocumentRequest({
      ...request,
      ...(activeProjectId ? { projectId: activeProjectId } : {}),
    });
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
  const navigationPreference =
    snapshot.navigationPreference ?? defaultNavigationPreference();
  const navigationOrder = [
    ...navigationPreference.desktop.pinned,
    ...navigationPreference.desktop.order.filter(
      (id) => !navigationPreference.desktop.pinned.includes(id),
    ),
  ].filter(
    (id): id is NavigationView =>
      navigation.some((entry) => entry.view === id) &&
      !navigationPreference.desktop.hidden.includes(id),
  );
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
    if (documentDirty || libraryDraft.current || projectBriefDirty.current) {
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
  const [status, setStatus] = useState(() => {
    const requested = new URLSearchParams(location.hash.split("?")[1]).get(
      "status",
    );
    return requested && workStatuses.includes(requested as WorkStatus)
      ? requested
      : currentView() === "tasks"
        ? "UNFINISHED"
        : "ALL";
  });
  const [activationFilter, setActivationFilter] = useState("ALL");
  const [priority, setPriority] = useState("ALL");
  const [sort, setSort] = useState("updated");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [editor, setEditorState] = useState<WorkItem | "new" | null>(null);
  const setEditor = (next: WorkItem | "new" | null) => {
    if (next && editor && next !== editor) {
      const change = new CustomEvent("atlas:task-detail-change", {
        cancelable: true,
        detail: () => setEditorState(next),
      });
      if (!window.dispatchEvent(change)) return;
    }
    setEditorState(next);
  };
  const [noteEditor, setNoteEditor] = useState<
    Note | "NOTE" | "JOURNAL" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!noteEditor) return;
    const entity = typeof noteEditor === "string" ? undefined : noteEditor;
    const kind = entity?.kind ?? (noteEditor as "NOTE" | "JOURNAL");
    const date = entity?.day ?? calendarDay;
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
  const { isPending, runPending } = usePendingOperations();
  const editorPendingKey =
    "editor:" + (editor === "new" ? "new" : (editor?.id ?? "none"));
  const busy = isPending(editorPendingKey);
  const [taskDependenciesOpen, setTaskDependenciesOpen] = useState(
    location.hash.includes("view=dependencies"),
  );
  const [loading, setLoading] = useState(true);
  const [syncOffline, setSyncOffline] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preference, setPreference] =
    useState<LocalePreference>(readPreference);
  const search = useRef<HTMLInputElement>(null);
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
      const nextProject = parseProjectRoute(location.hash);
      const leavingProject =
        currentView() !== "projects" ||
        nextProject.projectId !==
          parseProjectRoute(acceptedHash.current).projectId;
      if (
        (libraryDraft.current ||
          (projectBriefDirty.current && leavingProject)) &&
        !window.confirm(a("leave"))
      ) {
        history.replaceState(null, "", acceptedHash.current);
        return;
      }
      libraryDraft.current = false;
      if (leavingProject) projectBriefDirty.current = false;
      acceptedHash.current = location.hash;
      setProjectRoute(nextProject);
      if (nextProject.projectId) void refresh().catch(() => undefined);
      setView(currentView());
      setTaskDependenciesOpen(
        new URLSearchParams(location.hash.split("?")[1]).get("view") ===
          "dependencies",
      );
      setDocumentVisible(false);
      setQuery("");
      const requestedStatus = new URLSearchParams(
        location.hash.split("?")[1],
      ).get("status");
      setStatus(
        requestedStatus && workStatuses.includes(requestedStatus as WorkStatus)
          ? requestedStatus
          : currentView() === "tasks"
            ? "UNFINISHED"
            : "ALL",
      );
      setActivationFilter("ALL");
      setPriority("ALL");
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, [a]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        setCommandOpen((old) => !old);
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "n"
      ) {
        event.preventDefault();
        if (view === "notes") setNoteEditor("NOTE");
        else open("new");
        return;
      }
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
  async function run(
    action: () => Promise<unknown>,
    key = "action:" + crypto.randomUUID(),
  ): Promise<boolean> {
    if (isPending(key)) return false;
    setError(null);
    setSaved(false);
    try {
      await runPending(key, action);
      setSaved(true);
      // The mutation is already committed. Do not hold the modal open on a
      // secondary snapshot refresh (a slow/offline refresh used to look like
      // a frozen save and could re-enter the polling path).
      void refresh().catch(() => undefined);
      return true;
    } catch (cause) {
      setError(errorCode(cause));
      return false;
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
  const calendarTimezone = snapshot.calendarTimezone ?? "UTC";
  const [calendarInstant, setCalendarInstant] = useState(() =>
    new Date().toISOString(),
  );
  const calendarDay = localCalendarDay(calendarInstant, calendarTimezone);
  useEffect(() => {
    const update = () => setCalendarInstant(new Date().toISOString());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const taskSelection = selectTasks(
    allItems,
    snapshot.edges,
    calendarDay,
    isArchived,
  );
  const done = taskSelection.completedTasks;
  const displayedTasks = showArchived
    ? selectTasks(
        allItems,
        snapshot.edges,
        calendarDay,
        (item) => !isArchived(item),
      )
    : taskSelection;
  const executionActiveIds = new Set(
    displayedTasks.activeTasks.map((item) => item.id),
  );
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
  const visible = displayedTasks.tasks
    .filter(
      (item) =>
        item.type === "TASK" &&
        (activationFilter === "ALL" ||
          executionActiveIds.has(item.id) ===
            (activationFilter === "ACTIVE")) &&
        matches(item.title, item.descriptionMd) &&
        (view === "tasks" ||
          status === "ALL" ||
          (status === "UNFINISHED"
            ? ["TODO", "IN_PROGRESS"].includes(item.status)
            : item.status === status)) &&
        (priority === "ALL" || item.priority === priority) &&
        (projectFilter === "ALL" ||
          (projectFilter === "NONE"
            ? !item.projectIds?.length
            : projectMemberIds.has(item.id))),
    )
    .sort((a, b) =>
      sort === "priority"
        ? priorities.indexOf(b.priority) - priorities.indexOf(a.priority)
        : sort === "title"
          ? a.title.localeCompare(b.title, i18n.language)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const focus = taskSelection.focusTasks;
  const day = calendarDay;
  const count = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  function navigateProject(
    id: string | null,
    tab: ProjectTab = "overview",
    scope: "DIRECT" | "SUBTREE" = "SUBTREE",
  ) {
    if (
      id !== activeProjectId &&
      projectBriefDirty.current &&
      !window.confirm(a("leave"))
    )
      return;
    if (id !== activeProjectId) projectBriefDirty.current = false;
    const route = { projectId: id, tab, scope };
    const hash = projectHash(route);
    acceptedHash.current = hash;
    setProjectRoute(route);
    setView("projects");
    location.hash = hash;
  }
  function navigate(next: View, requestedStatus?: WorkStatus) {
    setDocumentVisible(false);
    if (
      (libraryDraft.current || projectBriefDirty.current) &&
      !window.confirm(a("leave"))
    )
      return;
    projectBriefDirty.current = false;
    libraryDraft.current = false;
    location.hash =
      next + (requestedStatus ? "?status=" + requestedStatus : "");
    setView(next);
    setMobileNavigationOpen(false);
    setSelectedNotes([]);
    setShowArchived(false);
    setFolderFilter(null);
    setProjectFilter("ALL");
    setQuery("");
    setStatus(requestedStatus ?? (next === "tasks" ? "UNFINISHED" : "ALL"));
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
    run(
      async () => {
        setSnapshot((current) => ({
          ...current,
          items: current.items.map((entry) =>
            entry.id === item.id ? { ...entry, status: next } : entry,
          ),
        }));
        try {
          const updated = await service.update(context, item.id, item.version, {
            status: next,
          });
          setSnapshot((current) => ({
            ...current,
            items: current.items.map((entry) =>
              entry.id === item.id ? (updated as WorkItem) : entry,
            ),
          }));
        } catch (failure) {
          setSnapshot((current) => ({
            ...current,
            items: current.items.map((entry) =>
              entry.id === item.id && entry.version === item.version
                ? item
                : entry,
            ),
          }));
          showToast(
            t("errors:" + errorCode(failure), {
              defaultValue: t("connectionError"),
            }),
          );
          throw failure;
        }
      },
      "task:" + item.id + ":status",
    );
  const workProps = {
    today: calendarDay,
    allItems,
    edges: snapshot.edges,
    busy: false,
    onOpen: open,
    isPending: (item: WorkItem) => isPending("task:" + item.id + ":status"),
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
  const assistantDocument = documentVisible
    ? (activeDocumentContext?.entity ?? null)
    : null;
  return (
    <AppShell collapsed={sidebarCollapsed} mobileOpen={mobileNavigationOpen}>
      <ToastHost />
      {commandOpen && (
        <CommandPalette
          snapshot={snapshot}
          onClose={() => setCommandOpen(false)}
          onCreate={() => open("new")}
          onOpen={(ref) => {
            if (ref.kind === "WORK") {
              const item = snapshot.items.find((entry) => entry.id === ref.id);
              if (item) setEditor(item);
            } else if (ref.kind === "NOTE") {
              const entity = snapshot.notes.find(
                (entry) => entry.id === ref.id,
              );
              if (entity)
                openDocument({ key: entity.id, kind: entity.kind, entity });
            } else {
              const entity = snapshot.library.find(
                (entry) => entry.id === ref.id,
              );
              if (entity)
                openDocument({
                  key: entity.id,
                  kind: entity.kind,
                  entity,
                  spaceId: entity.spaceId,
                });
            }
          }}
        />
      )}
      {assistantOpen && (
        <AssistantPane
          snapshot={snapshot}
          runtime={runtime}
          projectId={
            documentVisible
              ? activeDocumentContext?.projectId
              : (activeProjectId ?? undefined)
          }
          currentSpaceId={
            assistantDocument && "spaceId" in assistantDocument
              ? assistantDocument.kind === "SPACE"
                ? assistantDocument.id
                : (assistantDocument.spaceId ?? undefined)
              : undefined
          }
          onClose={() => setAssistantOpen(false)}
          context={
            assistantDocument && activeDocumentContext
              ? [
                  {
                    ref: {
                      kind:
                        activeDocumentContext.kind === "JOURNAL"
                          ? "NOTE"
                          : activeDocumentContext.kind,
                      id: assistantDocument.id,
                    },
                    title: assistantDocument.title,
                    version: assistantDocument.version,
                    source: "current",
                    tokenEstimate: Math.ceil(
                      assistantDocument.bodyMd.length / 4,
                    ),
                    permission:
                      assistantDocument.aiPolicy ?? privateContentPolicy,
                  },
                ]
              : []
          }
        />
      )}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        mobileOpen={mobileNavigationOpen}
        canAdmin={!runtime.account || runtime.account.role === "ADMIN"}
        activeView={view}
        navigationOrder={navigationOrder}
        taskCount={count(taskSelection.openActiveTasks.length)}
        noteCount={count(notes.filter((note) => note.kind === "NOTE").length)}
        label={viewLabel}
        onNavigate={navigate}
        onToggleMobile={() => setMobileNavigationOpen((value) => !value)}
        onDragNavigation={setDraggedNavigation}
        onMoveNavigation={moveNavigation}
        onLogout={() => {
          if (
            (documentDirty ||
              libraryDraft.current ||
              projectBriefDirty.current ||
              editor) &&
            !window.confirm(t("discardHint"))
          )
            return;
          void run(() => runtime.logout()).then((ok) => {
            if (ok) onLogout();
          });
        }}
      />
      <main className="workspace-main">
        <Topbar workspace={t("personal")} location={viewLabel(view)}>
          <span
            className={"mode-badge " + (error || syncOffline ? "offline" : "")}
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
        </Topbar>
        {view === "calendar" && (
          <p
            className="calendar-timezone muted"
            data-testid="calendar-timezone"
          >
            {t("calendarTimezone", { timezone: calendarTimezone })}
          </p>
        )}
        <DocumentWorkspace
          request={documentRequest}
          visible={documentVisible}
          onActive={setActiveDocumentContext}
          runtime={runtime}
          snapshot={snapshot}
          onDirty={setDocumentDirty}
          onChange={() => void refresh()}
          onBrowse={() => setDocumentVisible(false)}
          onVisibility={() => setDocumentVisible(true)}
        />
        <WorkspaceRouter view={view} hidden={documentVisible}>
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
            <ThemeSettings controls={view === "settings" && !loading} />
          </div>
          {loading ? (
            <div className="loading-panel" role="status">
              {t("connecting")}
            </div>
          ) : view === "library" ? (
            <LibraryView
              runtime={runtime}
              onOpen={openDocument}
              snapshot={snapshot}
            />
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
          ) : view === "ai" ? (
            <AssistantPane
              snapshot={snapshot}
              runtime={runtime}
              context={[]}
              embedded
              onClose={() => {}}
            />
          ) : view === "overview" ? (
            <>
              <div className="home-summary">
                {[
                  {
                    label: "openTasks",
                    value: taskSelection.openActiveTasks.length,
                    icon: ListTodo,
                    next: "tasks",
                  },
                  {
                    label: "focus",
                    value: focus.length,
                    icon: Target,
                    next: "focus",
                  },
                  {
                    label: "completed",
                    value: done.length,
                    icon: CheckCheck,
                    next: "tasks",
                  },
                  {
                    label: "savedNotes",
                    value: notes.length,
                    icon: BookOpen,
                    next: "notes",
                  },
                ].map(({ label, value, icon: Icon, next }) => (
                  <button
                    className="home-summary-link"
                    type="button"
                    key={label}
                    onClick={() =>
                      navigate(
                        next as View,
                        label === "completed" ? "DONE" : undefined,
                      )
                    }
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
                      {taskSelection.tasks.length
                        ? Math.round(
                            (done.length / taskSelection.tasks.length) * 100,
                          )
                        : 0}
                      %
                    </strong>
                  </div>
                  <progress
                    max={Math.max(taskSelection.tasks.length, 1)}
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
                  today={calendarDay}
                  isArchived={isArchived}
                  archiveSource={archiveSource}
                  onStatus={onStatus}
                  onOrganize={workProps.onOrganize}
                  briefDirtyRef={projectBriefDirty}
                  onBriefSave={(base, markdown) =>
                    run(() =>
                      service.update(context, base.id, base.version, {
                        descriptionMd: markdown,
                      }),
                    )
                  }
                  runtime={runtime}
                  run={(operation) =>
                    run(operation, "project:" + projectRoute.projectId)
                  }
                  key={activeProjectId}
                  project={
                    projects.find((project) => project.id === activeProjectId)!
                  }
                  snapshot={snapshot}
                  busy={false}
                  routeTab={projectRoute.tab}
                  routeScope={projectRoute.scope}
                  onRouteChange={(tab, scope) =>
                    navigateProject(activeProjectId, tab, scope)
                  }
                  onBack={() => navigateProject(null)}
                  onProject={(id) => navigateProject(id)}
                  onOpen={openEntity}
                  onNewPage={(spaceId) =>
                    openDocument({
                      key: `DOCUMENT:new:${crypto.randomUUID()}`,
                      kind: "DOCUMENT",
                      spaceId,
                      projectId: activeProjectId ?? undefined,
                    })
                  }
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
                    busy={false}
                    isArchived={isArchived}
                    archiveSource={archiveSource}
                    onOrganize={workProps.onOrganize}
                    onOpen={(project) => navigateProject(project.id)}
                    onTasks={(id) => {
                      navigate("tasks");
                      setProjectFilter(id);
                      const project = projects.find((p) => p.id === id);
                      setShowArchived(!!project && isArchived(project));
                    }}
                  />
                  <WorkflowManager
                    calendarTimezone={calendarTimezone}
                    records={snapshot.workflows ?? []}
                    projects={projects}
                    items={allItems}
                    busy={false}
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
              <details className="advanced-relations">
                <summary>
                  {i18n.language.startsWith("zh")
                    ? "高级关系"
                    : "Advanced relations"}
                </summary>
                <KnowledgeView
                  snapshot={snapshot}
                  busy={false}
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
                    } else if (
                      ref.kind === "SPACE" ||
                      ref.kind === "DOCUMENT"
                    ) {
                      const entity = snapshot.library.find(
                        (e) => e.id === ref.id,
                      );
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
              </details>
              <section className="panel">
                <h2>Atlas</h2>
                <AiSettingsView runtime={runtime} snapshot={snapshot} />
              </section>
              <NavigationSettings
                key={navigationPreference.version}
                preference={navigationPreference}
                busy={false}
                label={viewLabel}
                onSave={(preference) =>
                  run(() =>
                    service.setNavigationPreference(context, preference),
                  )
                }
              />
              <CalendarSettings
                settings={
                  snapshot.calendarSettings ?? { version: 0, timezone: null }
                }
                effective={calendarTimezone}
                busy={false}
                onSave={(version, timezone) =>
                  run(() =>
                    service.setCalendarSettings(context, version, timezone),
                  )
                }
              />
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
          ) : (
            <>
              <div className="list-toolbar">
                <div className={view === "tasks" ? "list-title" : "view-count"}>
                  <h2>{t(view)}</h2>
                  <span hidden={view === "tasks"}>
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
              {view === "tasks" && (
                <section className="task-query-panel">
                  <div className="filter-bar">
                    {view === "tasks" && (
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
                    <div className="field">
                      <span>{t("project")}</span>
                      <div className="project-filter-picker">
                        <button
                          type="button"
                          className="chip"
                          aria-pressed={projectFilter === "ALL"}
                          onClick={() => setProjectFilter("ALL")}
                        >
                          {t("all")}
                        </button>
                        <button
                          type="button"
                          className="chip"
                          aria-pressed={projectFilter === "NONE"}
                          onClick={() => setProjectFilter("NONE")}
                        >
                          {t("noProject")}
                        </button>
                        <ProjectDrilldownPicker
                          mode="single"
                          projects={projects}
                          value={
                            ["ALL", "NONE"].includes(projectFilter)
                              ? null
                              : projectFilter
                          }
                          onChange={(value) =>
                            setProjectFilter(
                              typeof value === "string" ? value : "ALL",
                            )
                          }
                        />
                      </div>{" "}
                    </div>
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
              ) : view === "tasks" ? (
                <>
                  {taskDependenciesOpen && (
                    <>
                      <ProjectDependencyGraph
                        snapshot={snapshot}
                        onOpen={(ref) => {
                          const item = snapshot.items.find(
                            (i) => i.id === ref.id,
                          );
                          if (item) setEditor(item);
                        }}
                      />
                      <Dependencies
                        items={allItems}
                        edges={snapshot.edges}
                        busy={false}
                        onAdd={(from, to) =>
                          run(() => service.addEdge(context, from, to))
                        }
                        onRemove={(id) =>
                          run(() => service.removeEdge(context, id))
                        }
                      />
                    </>
                  )}
                  <TasksWorkspace
                    onDependencies={() => {
                      setTaskDependenciesOpen((open) => !open);
                    }}
                    key={location.hash}
                    {...workProps}
                    items={visible}
                    includeArchived={showArchived}
                    initialTab={
                      status === "DONE"
                        ? "completed"
                        : status === "ALL" ||
                            new URLSearchParams(
                              location.hash.split("?")[1],
                            ).get("tab") === "all"
                          ? "all"
                          : "now"
                    }
                    initialBoard={
                      new URLSearchParams(location.hash.split("?")[1]).get(
                        "view",
                      ) === "board"
                    }
                  />
                </>
              ) : visible.length ? (
                <TaskList items={visible} {...workProps} />
              ) : (
                <div className="empty-state">
                  <ListTodo size={30} />
                  <h2>
                    {t(taskSelection.tasks.length ? "noResults" : "firstTask")}
                  </h2>
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
        </WorkspaceRouter>
      </main>
      <nav
        className="mobile-bottom-navigation"
        aria-label={t("mobileNavigation")}
      >
        {navigationPreference.mobile.pinned
          .map((id) => navigation.find((item) => item.view === id)!)
          .filter(
            (item) =>
              item.view !== "admin" ||
              !runtime.account ||
              runtime.account.role === "ADMIN",
          )
          .map(({ view: next, icon: Icon }) => (
            <button
              key={next}
              type="button"
              aria-current={view === next ? "page" : undefined}
              onClick={() => navigate(next)}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{viewLabel(next)}</span>
            </button>
          ))}
        <button
          type="button"
          aria-expanded={mobileNavigationOpen}
          aria-controls="workspace-navigation"
          onClick={() => {
            setMobileNavigationOpen((open) => !open);
          }}
        >
          <PanelLeft size={20} aria-hidden="true" />
          <span>{t("moreNavigation")}</span>
        </button>
      </nav>
      {mobileNavigationOpen && (
        <MoreSheet
          entries={[
            ...navigation
              .filter(
                ({ view: next }) =>
                  !navigationPreference.mobile.pinned.includes(next),
              )
              .filter(
                ({ view: next }) =>
                  next !== "admin" ||
                  !runtime.account ||
                  runtime.account.role === "ADMIN",
              )
              .map(({ view: next }) => ({ id: next, label: viewLabel(next) })),
            { id: "settings", label: viewLabel("settings") },
          ]}
          onNavigate={(next) => navigate(next as View)}
          onClose={() => setMobileNavigationOpen(false)}
        />
      )}
      {editor && (
        <WorkItemEditor
          key={editor === "new" ? "new" : editor.id + "-" + editor.version}
          item={editor === "new" ? null : editor}
          projects={projects}
          categories={snapshot.categories ?? []}
          items={allItems}
          createType={creation.type}
          edges={snapshot.edges}
          today={calendarDay}
          initialProjectId={creation.parentId}
          busy={busy}
          error={errorMessage}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            if (
              await run(
                () =>
                  editor === "new"
                    ? service.create(context, {
                        ...input,
                        type: creation.type,
                      })
                    : service.update(context, editor.id, editor.version, input),
                editorPendingKey,
              )
            )
              setEditorState((current) =>
                current === editor ? null : current,
              );
          }}
          onDelete={
            editor === "new"
              ? null
              : async () => {
                  if (
                    await run(
                      () =>
                        service.setDeleted(
                          context,
                          editor.id,
                          editor.version,
                          true,
                        ),
                      editorPendingKey,
                    )
                  )
                    setEditorState((current) =>
                      current === editor ? null : current,
                    );
                }
          }
        />
      )}
    </AppShell>
  );
}
