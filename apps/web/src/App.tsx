import type {
  EntityRef,
  WorkspaceNote as Note,
  OrganizeInput,
} from "@arclattice/application";
import {
  bodyCharacterCount,
  privateContentPolicy,
} from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  defaultNavigationPreference,
  localCalendarDay,
  priorities,
  type WorkItem,
  type WorkStatus,
  workStatuses,
} from "@arclattice/domain";
import { type LocalePreference, resolveLocale } from "@arclattice/i18n";
import {
  ArrowUpRight,
  BookOpen,
  CheckCheck,
  ListTodo,
  NotebookPen,
  PanelLeft,
  Plus,
  Search,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountView, AdminView } from "./AccountViews";
import { AppUpdater } from "./AppUpdater";
import { AppShell } from "./app/AppShell";
import { CommandPalette } from "./app/CommandPalette";
import { ContextPane } from "./app/ContextPane";
import { EntitySelectionContext } from "./app/EntitySelection";
import { createTaskPresentationStore } from "./app/hooks/task-presentation-store";
import { useNotifications } from "./app/hooks/useNotifications";
import { usePendingOperations } from "./app/hooks/usePendingOperations";
import { useViewScroll } from "./app/hooks/useViewScroll";
import { useViewState } from "./app/hooks/useViewState";
import { useWorkspaceSync } from "./app/hooks/useWorkspaceSync";
import { createViewStore } from "./app/hooks/view-store";
import {
  currentView,
  type NavigationView,
  navigation,
  SIDEBAR_COLLAPSED_KEY,
  type View,
} from "./app/navigation";
import { CalendarRoute } from "./app/routes/CalendarRoute";
import { GraphRoute } from "./app/routes/GraphRoute";
import { SettingsRoute } from "./app/routes/SettingsRoute";
import { TasksRoute } from "./app/routes/TasksRoute";
import { TrashRoute } from "./app/routes/TrashRoute";
import { Sidebar } from "./app/Sidebar";
import { StartupShell } from "./app/StartupShell";
import { SyncStatus } from "./app/SyncStatus";
import { showToast, ToastHost } from "./app/ToastHost";
import { Topbar } from "./app/Topbar";
import { WorkspaceRouter } from "./app/WorkspaceRouter";
import { type Runtime, readPreference, savePreference } from "./bootstrap";
import { Button, Toolbar } from "./components/ui/Button";
import { confirmAction } from "./components/ui/ConfirmationHost";
import { EntityRow } from "./components/ui/Content";
import { EntityMenu } from "./components/ui/EntityMenu";
import { Popover, Select } from "./components/ui/Surfaces";
import { type DocumentRequest, DocumentWorkspace } from "./DocumentWorkspace";
import { AssistantPane } from "./features/ai/AssistantPane";
import { PickerIdentityContext } from "./features/hierarchy/PickerIdentityContext";
import { MoreSheet } from "./features/mobile/MoreSheet";
import { ProjectDrilldownPicker } from "./features/projects/ProjectDrilldownPicker";
import type { TaskPresentation } from "./features/tasks/TasksWorkspace";
import { selectTasks } from "./features/tasks/task-selectors";
import {
  buildWorkspaceWorkIndex,
  WorkspaceWorkIndexContext,
} from "./features/tasks/workspace-work-index";
import { LibraryView } from "./LibraryView";
import { Login } from "./Login";
import { PrivateImageContext } from "./Markdown";
import { ProjectView } from "./PlanningViews";
import { ProjectWorkspace } from "./ProjectWorkspace";
import {
  type ProjectTab,
  parseProjectRoute,
  projectHash,
} from "./projectRoute";
import { nextCalendarDayInstant } from "./utils/next-calendar-day";
import { useDebouncedValue } from "./utils/use-debounced-value";
import { WorkflowManager } from "./WorkflowManager";
import { WorkItemEditor } from "./WorkItemEditor";
import { TaskList } from "./WorkViews";

export function App({ runtime }: { runtime: Runtime }) {
  const [context, setContext] = useState(runtime.context);
  const [ready, setReady] = useState(runtime.initialized);
  useEffect(() => {
    let active = true;
    void runtime.initialize().then(() => {
      if (!active) return;
      setContext(runtime.context);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [runtime]);
  if (!ready) return <StartupShell />;
  return context ? (
    <PickerIdentityContext.Provider
      value={{
        server: runtime.serverOrigin || location.origin,
        workspaceId: context.workspaceId,
        principalId: context.principalId,
      }}
    >
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
    </PickerIdentityContext.Provider>
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
  const [libraryViewState, setLibraryViewState] = useState<{
    spaceId: string | null;
    query: string;
  }>({ spaceId: null, query: "" });
  const acceptedHash = useRef(location.hash);
  const [creation, setCreation] = useState<{
    type: "TASK" | "PROJECT" | "MILESTONE";
    parentId: string;
    day?: string | undefined;
  }>({ type: "TASK", parentId: "" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
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
  const [error, setError] = useState<string | null>(null);
  const { snapshot, setSnapshot, loading, syncOffline, refresh } =
    useWorkspaceSync(runtime, setError);
  const [query, setQuery] = useViewState(view, "");
  const [selectedEntity, setSelectedEntity] = useViewState<EntityRef | null>(
    view,
    null,
  );
  const taskPresentationStore = useMemo(
    () =>
      createTaskPresentationStore({
        tab:
          new URLSearchParams(location.hash.split("?")[1]).get("tab") === "all"
            ? "all"
            : "now",
        view:
          new URLSearchParams(location.hash.split("?")[1]).get("view") ===
          "board"
            ? "board"
            : "list",
      }),
    [],
  );
  const setTaskPresentation = taskPresentationStore.set;
  const [projectTaskPresentation, setProjectTaskPresentation] =
    useViewState<TaskPresentation>(
      `project-presentation:${activeProjectId ?? "root"}`,
      { tab: "now", view: "list" },
    );
  useViewScroll(
    view === "projects" ? `projects:${activeProjectId ?? "root"}` : view,
    !loading && (!documentVisible || view === "graph"),
  );
  const searchQuery = useDebouncedValue(query, 200);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const advancedFiltersAnchor = useRef<HTMLButtonElement>(null);
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
  const [showArchived, setShowArchived, setViewArchived] = useViewState(
    view,
    false,
  );
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useViewState<string | null>(
    view,
    null,
  );
  const [moveFolder, setMoveFolder] = useState("");
  const workIndex = useMemo(
    () => buildWorkspaceWorkIndex(snapshot.items, snapshot.organization ?? []),
    [snapshot.items, snapshot.organization],
  );
  const { archiveSource, isArchived } = workIndex;
  const organization = (kind: "WORK" | "NOTE", id: string) =>
    workIndex.organizationByKey.get(`${kind}:${id}`);
  async function organize(input: OrganizeInput) {
    if (documentDirty || libraryDraft.current || projectBriefDirty.current) {
      showToast(t("saveBeforeOrganize"));
      return;
    }
    if (
      await run(async () => {
        await runtime.organize(input);
        if (input.action === "delete")
          showToast(t("movedToTrash"), async () => {
            const current = await runtime.loadWorkspace();
            for (const entry of input.entries) {
              const deleted =
                input.kind === "WORK"
                  ? current.items.find((item) => item.id === entry.id)
                  : current.notes.find((item) => item.id === entry.id);
              if (!deleted?.deletedAt) continue;
              if (input.kind === "WORK")
                await service.setDeleted(
                  context,
                  deleted.id,
                  deleted.version,
                  false,
                );
              else await runtime.deleteNote(deleted.id, deleted.version, false);
            }
            await refresh();
          });
      })
    )
      setSelectedNotes([]);
  }
  const [status, setStatus] = useViewState(view, () => {
    const requested = new URLSearchParams(location.hash.split("?")[1]).get(
      "status",
    );
    return requested && workStatuses.includes(requested as WorkStatus)
      ? requested
      : currentView() === "tasks"
        ? "UNFINISHED"
        : "ALL";
  });
  const [activationFilter, setActivationFilter] = useViewState(view, "ALL");
  const [priority, setPriority] = useViewState(view, "ALL");
  const [sort, setSort] = useViewState(view, "updated");
  const [projectFilter, setProjectFilter, setProjectFilterForView] =
    useViewState(view, "ALL");
  useEffect(() => {
    if (view !== "tasks") return;
    const requested = new URLSearchParams(location.hash.split("?")[1]).get(
      "status",
    );
    if (requested && workStatuses.includes(requested as WorkStatus))
      setStatus(requested);
    if (
      new URLSearchParams(location.hash.split("?")[1]).get("view") ===
      "dependencies"
    )
      setTaskDependenciesOpen(true);
  }, [view]);
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
  const [preference, setPreference] =
    useState<LocalePreference>(readPreference);
  const search = useRef<HTMLInputElement>(null);
  const { service } = runtime;
  function errorCode(cause: unknown) {
    return cause instanceof DomainError ? String(cause.code) : "UNAVAILABLE";
  }
  useEffect(() => {
    const listener = async () => {
      if (
        currentView() === "graph" &&
        acceptedHash.current.startsWith("#graph/")
      ) {
        acceptedHash.current = location.hash;
        return;
      }
      const nextProject = parseProjectRoute(location.hash);
      const leavingProject =
        currentView() !== "projects" ||
        nextProject.projectId !==
          parseProjectRoute(acceptedHash.current).projectId;
      if (
        (libraryDraft.current ||
          (projectBriefDirty.current && leavingProject)) &&
        !(await confirmAction(a("leave")))
      ) {
        history.replaceState(null, "", acceptedHash.current);
        return;
      }
      libraryDraft.current = false;
      if (leavingProject) projectBriefDirty.current = false;
      acceptedHash.current = location.hash;
      setProjectRoute(nextProject);
      if (nextProject.projectId) void refresh().catch(() => undefined);
      const nextView = currentView();
      if (nextView === "tasks") {
        const requested = new URLSearchParams(location.hash.split("?")[1]);
        const requestedView = requested.get("view");
        const requestedTab = requested.get("tab");
        setTaskPresentation((previous) => ({
          tab: requestedTab === "all" ? "all" : previous.tab,
          view:
            requestedView === "board" ||
            requestedView === "list" ||
            requestedView === "timeline"
              ? requestedView
              : previous.view,
        }));
      }
      setView(nextView);
      if (currentView() !== "graph") setDocumentVisible(false);
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
    try {
      await runPending(key, action);
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
  const allItems = useMemo(
    () => snapshot.items.filter((item) => !item.deletedAt),
    [snapshot.items],
  );
  const projects = useMemo(
    () => allItems.filter((item) => item.type === "PROJECT"),
    [allItems],
  );
  const items = useMemo(
    () =>
      allItems.filter((item) => item.type !== "PROJECT" && !isArchived(item)),
    [allItems, isArchived],
  );
  const notes = useMemo(
    () => snapshot.notes.filter((note) => !note.deletedAt),
    [snapshot.notes],
  );
  const calendarTimezone = snapshot.calendarTimezone ?? "UTC";
  const [calendarInstant, setCalendarInstant] = useState(() =>
    new Date().toISOString(),
  );
  const calendarDay = localCalendarDay(calendarInstant, calendarTimezone);
  const [calendarViewStore] = useState(() =>
    createViewStore(
      { month: calendarDay.slice(0, 7), selected: calendarDay },
      (previous, next) =>
        previous.month === next.month && previous.selected === next.selected,
    ),
  );
  const initialCalendarDay = useRef(calendarDay);
  const calendarInitialized = useRef(false);
  useEffect(() => {
    if (loading || calendarInitialized.current) return;
    calendarInitialized.current = true;
    calendarViewStore.set((previous) =>
      previous.selected === initialCalendarDay.current &&
      previous.month === initialCalendarDay.current.slice(0, 7)
        ? { month: calendarDay.slice(0, 7), selected: calendarDay }
        : previous,
    );
  }, [loading, calendarDay, calendarViewStore]);
  const notifications = useNotifications(
    runtime,
    context,
    snapshot,
    calendarDay,
    i18n.language.startsWith("zh") ? "zh-CN" : "en-US",
    loading,
  );
  useEffect(() => {
    let timer: number;
    const update = () => {
      const now = new Date().toISOString();
      setCalendarInstant((previous) =>
        localCalendarDay(previous, calendarTimezone) ===
        localCalendarDay(now, calendarTimezone)
          ? previous
          : now,
      );
      window.clearTimeout(timer);
      timer = window.setTimeout(
        update,
        Math.max(
          1,
          nextCalendarDayInstant(Date.now(), calendarTimezone) -
            Date.now() +
            50,
        ),
      );
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [calendarTimezone]);
  const taskSelection = useMemo(
    () =>
      selectTasks(
        allItems,
        snapshot.edges,
        calendarDay,
        isArchived,
        undefined,
        workIndex,
      ),
    [allItems, snapshot.edges, calendarDay, isArchived, workIndex],
  );
  const done = taskSelection.completedTasks;
  const displayedTasks = showArchived ? taskSelection.archived : taskSelection;
  const executionActiveIds = new Set(
    displayedTasks.activeTasks.map((item) => item.id),
  );
  const searchTextById = useMemo(
    () =>
      new Map([
        ...allItems.map(
          (item) =>
            [
              item.id,
              (item.title + " " + item.descriptionMd).toLocaleLowerCase(
                i18n.language,
              ),
            ] as const,
        ),
      ]),
    [allItems, i18n.language],
  );
  const normalizedQuery = searchQuery.toLocaleLowerCase(i18n.language);
  const [noteSearch, setNoteSearch] = useState<{
    query: string;
    ids: ReadonlySet<string>;
  } | null>(null);
  useEffect(() => {
    if (!normalizedQuery || (view !== "notes" && view !== "journal")) return;
    let active = true;
    void runtime.searchNotes(searchQuery).then(
      (ids) => {
        if (active)
          setNoteSearch({ query: normalizedQuery, ids: new Set(ids) });
      },
      (cause: unknown) => {
        if (active) setError(errorCode(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [runtime, searchQuery, normalizedQuery, view, snapshot.notes]);
  const matchesNote = (id: string) =>
    !normalizedQuery ||
    (noteSearch?.query === normalizedQuery && noteSearch.ids.has(id));
  const matches = (id: string) =>
    !normalizedQuery ||
    (searchTextById.get(id)?.includes(normalizedQuery) ?? false);
  const projectMemberIds = useMemo(() => {
    const ids = new Set<string>(),
      pending = [projectFilter],
      visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const taskId of workIndex.tasksByProjectId.get(id) ?? [])
        ids.add(taskId);
      pending.push(...(workIndex.childrenByProjectId.get(id) ?? []));
    }
    return ids;
  }, [projectFilter, workIndex]);
  const visible = displayedTasks.tasks
    .filter(
      (item) =>
        item.type === "TASK" &&
        (activationFilter === "ALL" ||
          executionActiveIds.has(item.id) ===
            (activationFilter === "ACTIVE")) &&
        matches(item.id) &&
        ((view === "tasks" && (status === "ALL" || status === "UNFINISHED")) ||
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
  async function navigateProject(
    id: string | null,
    tab: ProjectTab = "overview",
    scope: "DIRECT" | "SUBTREE" = "SUBTREE",
  ) {
    if (
      id !== activeProjectId &&
      projectBriefDirty.current &&
      !(await confirmAction(a("leave")))
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
  async function navigate(next: View, requestedStatus?: WorkStatus) {
    setDocumentVisible(false);
    if (
      (libraryDraft.current || projectBriefDirty.current) &&
      !(await confirmAction(a("leave")))
    )
      return;
    projectBriefDirty.current = false;
    libraryDraft.current = false;
    location.hash =
      next + (requestedStatus ? "?status=" + requestedStatus : "");
    setView(next);
    setMobileNavigationOpen(false);
    setSelectedNotes([]);
    if (requestedStatus && next === view) setStatus(requestedStatus);
  }
  function open(item: WorkItem | "new") {
    setError(null);
    if (item === "new")
      setCreation({
        type: view === "projects" ? "PROJECT" : "TASK",
        parentId: "",
        day:
          view === "calendar"
            ? calendarViewStore.getSnapshot().selected
            : undefined,
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
  function openJournal(date: string) {
    const entity =
      snapshot.notes.find(
        (note) =>
          note.kind === "JOURNAL" && note.day === date && !note.deletedAt,
      ) ??
      snapshot.notes
        .filter((note) => note.kind === "JOURNAL" && note.day === date)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    openDocument({
      key: entity?.id ?? "journal-" + date,
      kind: "JOURNAL",
      entity,
      day: date,
    });
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
  async function trashWorkItem(item: WorkItem) {
    const deleted = await service.setDeleted(
      context,
      item.id,
      item.version,
      true,
    );
    showToast(t("movedToTrash"), async () => {
      await service.setDeleted(context, deleted.id, deleted.version, false);
      await refresh();
    });
  }
  const workProps = {
    taskIndex: displayedTasks,
    derived: taskSelection.derived,
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
      if (item.type === "PROJECT" && action === "delete") {
        void run(() => trashWorkItem(item), "project:" + item.id + ":delete");
        return;
      }
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
          <Button
            type="button"
            variant="secondary"
            disabled={!selectedNotes.length || busy}
            onClick={() => setSelectedNotes([])}
          >
            {t("clearSelection")}
          </Button>
          <label>
            {t("folder")}
            <Select
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
            </Select>
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
              <Button
                type="button"
                variant="secondary"
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
              </Button>
              <Button
                type="button"
                variant="secondary"
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
              </Button>
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
                <EntityRow
                  className="note-card"
                  key={note.id}
                  selected={
                    selectedEntity?.kind === "NOTE" &&
                    selectedEntity.id === note.id
                  }
                  onSelect={() => {
                    setSelectedEntity({ kind: "NOTE", id: note.id });
                    setAssistantOpen(false);
                  }}
                  onOpen={() => openNote(note)}
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
                  {note.bodyMd !== undefined && (
                    <p>{note.bodyMd.slice(0, 180) || t("emptyNote")}</p>
                  )}
                  <footer>
                    <span>{t("private")}</span>
                    <EntityMenu
                      title={note.title}
                      pending={busy}
                      onOpen={() => openNote(note)}
                      onDelete={() =>
                        void run(async () => {
                          const deleted = await runtime.deleteNote(
                            note.id,
                            note.version,
                            true,
                          );
                          showToast(
                            i18n.language.startsWith("zh")
                              ? "已移至回收站"
                              : "Moved to Trash",
                            async () => {
                              await runtime.deleteNote(
                                deleted.id,
                                deleted.version,
                                false,
                              );
                              await refresh();
                            },
                          );
                        })
                      }
                    />
                  </footer>
                </EntityRow>
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
    <WorkspaceWorkIndexContext.Provider value={workIndex}>
      <EntitySelectionContext.Provider
        value={{
          selected: selectedEntity,
          select: (ref) => {
            setSelectedEntity(ref);
            setAssistantOpen(false);
          },
        }}
      >
        <AppShell
          collapsed={sidebarCollapsed}
          mobileOpen={mobileNavigationOpen}
        >
          <ToastHost />
          {commandOpen && (
            <CommandPalette
              snapshot={snapshot}
              selectedDay={
                view === "calendar"
                  ? calendarViewStore.getSnapshot().selected
                  : undefined
              }
              onClose={() => setCommandOpen(false)}
              onCreate={() => open("new")}
              recentKey={`orivane-atlas.commands.${runtime.serverOrigin}.${context.workspaceId}.${context.principalId}`}
              onNavigate={(next) => void navigate(next)}
              onCreateKind={(kind) => {
                if (kind === "JOURNAL" && view === "calendar")
                  openJournal(calendarViewStore.getSnapshot().selected);
                else if (kind === "NOTE" || kind === "JOURNAL") openNote(kind);
                else {
                  setCreation({
                    type: kind,
                    parentId: activeProjectId ?? "",
                    day:
                      view === "calendar"
                        ? calendarViewStore.getSnapshot().selected
                        : undefined,
                  });
                  setEditor("new");
                }
              }}
              onOpen={(ref) => {
                if (ref.kind === "WORK") {
                  const item = snapshot.items.find(
                    (entry) => entry.id === ref.id,
                  );
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
          {(assistantOpen ||
            (selectedEntity &&
              !documentVisible &&
              !(
                view === "projects" &&
                selectedEntity.kind === "WORK" &&
                selectedEntity.id === activeProjectId
              ))) &&
            !editor && (
              <ContextPane
                selected={selectedEntity}
                snapshot={snapshot}
                atlas={assistantOpen}
                onMode={setAssistantOpen}
                onClose={() => {
                  setAssistantOpen(false);
                  setSelectedEntity(null);
                }}
                onOpen={(ref) => {
                  const item =
                    ref.kind === "WORK"
                      ? workIndex.itemsById.get(ref.id)
                      : undefined;
                  if (item?.type === "PROJECT") void navigateProject(item.id);
                  else openEntity(ref);
                }}
              >
                {assistantOpen && (
                  <AssistantPane
                    onSource={openEntity}
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
                                bodyCharacterCount(assistantDocument) / 4,
                              ),
                              permission:
                                assistantDocument.aiPolicy ??
                                privateContentPolicy,
                            },
                          ]
                        : []
                    }
                  />
                )}
              </ContextPane>
            )}
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebar}
            mobileOpen={mobileNavigationOpen}
            canAdmin={!runtime.account || runtime.account.role === "ADMIN"}
            activeView={view}
            navigationOrder={navigationOrder}
            taskCount={count(taskSelection.openActiveTasks.length)}
            noteCount={count(
              notes.filter((note) => note.kind === "NOTE").length,
            )}
            label={viewLabel}
            onNavigate={navigate}
            onToggleMobile={() => setMobileNavigationOpen((value) => !value)}
            onLogout={async () => {
              if (
                (documentDirty ||
                  libraryDraft.current ||
                  projectBriefDirty.current ||
                  editor) &&
                !(await confirmAction(t("discardHint")))
              )
                return;
              void run(() => runtime.logout()).then((ok) => {
                if (ok) onLogout();
              });
            }}
          />
          <main className="workspace-main">
            <Topbar
              location={viewLabel(view)}
              path={
                view === "projects" &&
                activeProjectId &&
                workIndex.projectsById.has(activeProjectId)
                  ? [
                      {
                        id: "projects",
                        label: viewLabel("projects"),
                        onActivate: () => void navigate("projects"),
                      },
                      ...(
                        workIndex.ancestorIdsByProjectId.get(activeProjectId) ??
                        []
                      )
                        .slice()
                        .reverse()
                        .map((id) => ({
                          id,
                          label: workIndex.projectsById.get(id)!.title,
                          onActivate: () => void navigateProject(id),
                        })),
                      {
                        id: activeProjectId,
                        label:
                          workIndex.projectsById.get(activeProjectId)!.title,
                      },
                    ]
                  : view === "library" && libraryViewState.spaceId
                    ? [
                        {
                          id: "library",
                          label: viewLabel("library"),
                          onActivate: () =>
                            setLibraryViewState((current) => ({
                              ...current,
                              spaceId: null,
                            })),
                        },
                        {
                          id: libraryViewState.spaceId,
                          label:
                            snapshot.library.find(
                              (entry) => entry.id === libraryViewState.spaceId,
                            )?.title ?? viewLabel("library"),
                        },
                      ]
                    : []
              }
            >
              <SyncStatus
                loading={loading}
                offline={syncOffline}
                onRetry={() => void refresh()}
              />
              {!(
                [
                  "graph",
                  "settings",
                  "trash",
                  "ai",
                  "library",
                  "account",
                  "admin",
                ] as string[]
              ).includes(view) && (
                <Button
                  variant="primary"
                  className="compact-create"
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
                </Button>
              )}
            </Topbar>
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
              {view === "graph" && (
                <GraphRoute
                  workIndex={workIndex}
                  atlasOpen={assistantOpen}
                  onAtlas={() => setAssistantOpen(true)}
                  onRouteAccepted={() => {
                    acceptedHash.current = location.hash;
                  }}
                  snapshot={snapshot}
                  onOpen={openEntity}
                />
              )}
              {errorMessage && !editor && !noteEditor && (
                <div className="error" role="alert">
                  {errorMessage}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void refresh()}
                  >
                    {t("refresh")}
                  </Button>
                  {error === "UNAUTHORIZED" && (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={onLogout}
                    >
                      {t("unlock")}
                    </Button>
                  )}
                </div>
              )}
              <SettingsRoute
                notifications={notifications}
                active={view === "settings" && !loading}
                context={context}
                runtime={runtime}
                snapshot={snapshot}
                busy={busy}
                day={day}
                preference={preference}
                switchLanguage={switchLanguage}
                run={run}
                onNote={setNoteEditor}
                onWork={setEditor}
                openDocument={openDocument}
                navigation={{
                  preference: navigationPreference,
                  busy: false,
                  label: viewLabel,
                  onSave: (preference) =>
                    run(() =>
                      service.setNavigationPreference(context, preference),
                    ),
                }}
                calendar={{
                  settings: snapshot.calendarSettings ?? {
                    version: 0,
                    timezone: null,
                  },
                  effective: calendarTimezone,
                  busy: false,
                  onSave: (version, timezone) =>
                    run(() =>
                      service.setCalendarSettings(context, version, timezone),
                    ),
                }}
                onLogout={async () => {
                  void (
                    (documentDirty || libraryDraft.current || editor) &&
                    !(await confirmAction(t("discardHint")))
                      ? Promise.resolve(false)
                      : run(() => runtime.logout())
                  ).then((ok) => {
                    if (ok) onLogout();
                  });
                }}
              />

              {loading ? (
                <div className="loading-panel" role="status">
                  {t("connecting")}
                </div>
              ) : view === "library" ? (
                <LibraryView
                  viewState={libraryViewState}
                  onViewChange={setLibraryViewState}
                  onTrash={() => {
                    location.hash = "#trash?filter=library";
                  }}
                  onChanged={refresh}
                  runtime={runtime}
                  onOpen={openDocument}
                  snapshot={snapshot}
                />
              ) : view === "account" ? (
                <AccountView
                  runtime={runtime}
                  onLogout={onLogout}
                  confirmLeave={async () =>
                    !(documentDirty || libraryDraft.current || editor) ||
                    (await confirmAction(t("discardHint")))
                  }
                />
              ) : view === "admin" ? (
                <AdminView runtime={runtime} />
              ) : view === "ai" ? (
                <AssistantPane
                  onSource={openEntity}
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
                      <Button
                        className="home-summary-link"
                        type="button"
                        key={label}
                        onClick={() => {
                          if (next === "tasks")
                            setProjectFilterForView("tasks", "ALL");
                          navigate(
                            next as View,
                            label === "completed" ? "DONE" : undefined,
                          );
                        }}
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
                      </Button>
                    ))}
                  </div>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <p className="eyebrow">{t("nextStep")}</p>
                          <h2>{t("focus")}</h2>
                        </div>
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() => navigate("focus")}
                        >
                          {t("viewAll")}
                          <ArrowUpRight size={15} />
                        </Button>
                      </div>
                      {focus.length ? (
                        <TaskList items={focus.slice(0, 5)} {...workProps} />
                      ) : (
                        <div className="empty-state compact">
                          <Target size={30} />
                          <h3>{t("focusEmpty")}</h3>
                          <p>{t("focusEmptyHint")}</p>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => open("new")}
                          >
                            {t("newTask")}
                          </Button>
                        </div>
                      )}
                    </section>
                    <section className="today-panel">
                      <span className="eyebrow">{t("dailySpace")}</span>
                      <NotebookPen size={30} />
                      <h2>{t("journalPrompt")}</h2>
                      <p>{t("journalPromptHint")}</p>
                      <Button
                        variant="secondary"
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
                      </Button>
                      <div className="progress-label">
                        <span>{t("completion")}</span>
                        <strong>
                          {taskSelection.tasks.length
                            ? Math.round(
                                (done.length / taskSelection.tasks.length) *
                                  100,
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
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => navigate("notes")}
                      >
                        {t("viewAll")}
                        <ArrowUpRight size={15} />
                      </Button>
                    </div>
                    {notes.length ? (
                      noteCards(
                        [...notes]
                          .sort((a, b) =>
                            b.updatedAt.localeCompare(a.updatedAt),
                          )
                          .slice(0, 3),
                      )
                    ) : (
                      <Button
                        className="note-empty"
                        type="button"
                        onClick={() => openNote("NOTE")}
                      >
                        <BookOpen size={22} />
                        <span>{t("firstNote")}</span>
                        <Plus size={18} />
                      </Button>
                    )}
                  </section>
                </>
              ) : view === "projects" ? (
                <>
                  {projects.find(
                    (project) => project.id === activeProjectId,
                  ) ? (
                    <ProjectWorkspace
                      taskPresentation={projectTaskPresentation}
                      onTaskPresentationChange={setProjectTaskPresentation}
                      workIndex={workIndex}
                      taskIndex={taskSelection}
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
                        projects.find(
                          (project) => project.id === activeProjectId,
                        )!
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
                        onEdit={workProps.onOpen}
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
                          setProjectFilterForView("tasks", id);
                          const project = projects.find((p) => p.id === id);
                          setViewArchived(
                            "tasks",
                            !!project && isArchived(project),
                          );
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
                        save={(input) =>
                          run(() => runtime.saveRecurrence(input))
                        }
                        generate={(id, version, from, to) =>
                          run(() =>
                            runtime.generateRecurrence(id, version, from, to),
                          )
                        }
                        backfill={(id, version, completedAt) =>
                          run(() =>
                            runtime.backfillOccurrence(
                              id,
                              version,
                              completedAt,
                            ),
                          )
                        }
                      />
                    </>
                  )}
                </>
              ) : view === "calendar" ? (
                <CalendarRoute
                  viewStore={calendarViewStore}
                  onCreateTask={(date) => {
                    setCreation({ type: "TASK", parentId: "", day: date });
                    setEditor("new");
                  }}
                  pickerItems={allItems}
                  reminders={snapshot.reminders ?? []}
                  onSaveReminder={(id, version, input, deleted) =>
                    run(
                      () => runtime.saveReminder(id, version, input, deleted),
                      "reminder:" + (id ?? "new"),
                    )
                  }
                  timezone={calendarTimezone}
                  records={snapshot.workflows ?? []}
                  items={items}
                  today={day}
                  onOpen={open}
                  journals={snapshot.notes}
                  onJournal={openJournal}
                />
              ) : view === "settings" || view === "graph" ? null : (
                <>
                  <div className="list-toolbar">
                    <div
                      className={view === "tasks" ? "list-title" : "view-count"}
                    >
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
                              ? snapshot.items.filter((i) => i.deletedAt)
                                  .length +
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
                      <Toolbar className="filter-bar">
                        <div className="task-project-filter">
                          <span>{t("project")}</span>
                          <div className="project-filter-picker">
                            <Button
                              type="button"
                              variant="toggle"
                              aria-pressed={projectFilter === "ALL"}
                              onClick={() => setProjectFilter("ALL")}
                            >
                              {t("all")}
                            </Button>
                            <Button
                              type="button"
                              variant="toggle"
                              aria-pressed={projectFilter === "NONE"}
                              onClick={() => setProjectFilter("NONE")}
                            >
                              {t("noProject")}
                            </Button>
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
                          <Select
                            aria-label={t("status")}
                            value={status}
                            onChange={(event) => {
                              const next = event.target.value;
                              setStatus(next);
                              if (view === "tasks")
                                setTaskPresentation((current) => ({
                                  ...current,
                                  tab:
                                    next === "DONE"
                                      ? "completed"
                                      : next === "ALL"
                                        ? "all"
                                        : "now",
                                }));
                            }}
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
                          </Select>
                        </label>
                        <label>
                          <span>{t("priority")}</span>
                          <Select
                            aria-label={t("priority")}
                            value={priority}
                            onChange={(event) =>
                              setPriority(event.target.value)
                            }
                          >
                            <option value="ALL">{t("all")}</option>
                            {priorities.map((p) => (
                              <option key={p} value={p}>
                                {t("work:priorities." + p)}
                              </option>
                            ))}
                          </Select>
                        </label>
                        <label className="sort-control">
                          <span>{t("sort")}</span>
                          <Select
                            aria-label={t("sort")}
                            value={sort}
                            onChange={(event) => setSort(event.target.value)}
                          >
                            <option value="updated">
                              {t("recentlyUpdated")}
                            </option>
                            <option value="priority">{t("priority")}</option>
                            <option value="title">{t("title")}</option>
                          </Select>
                        </label>
                        <Button
                          ref={advancedFiltersAnchor}
                          aria-expanded={advancedFiltersOpen}
                          onClick={() =>
                            setAdvancedFiltersOpen((value) => !value)
                          }
                        >
                          {i18n.language.startsWith("zh")
                            ? "更多筛选"
                            : "More filters"}
                        </Button>
                        {advancedFiltersOpen && (
                          <Popover
                            anchorRef={advancedFiltersAnchor}
                            label={
                              i18n.language.startsWith("zh")
                                ? "更多筛选"
                                : "More filters"
                            }
                            onDismiss={() => setAdvancedFiltersOpen(false)}
                          >
                            {" "}
                            {view === "tasks" && (
                              <label>
                                <span>{t("activationState")}</span>
                                <Select
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
                                </Select>
                              </label>
                            )}
                            <label>
                              <input
                                type="checkbox"
                                checked={showArchived}
                                onChange={(e) =>
                                  setShowArchived(e.target.checked)
                                }
                              />
                              {t("showArchived")}
                            </label>
                          </Popover>
                        )}
                      </Toolbar>
                    </section>
                  )}
                  {view === "notes" || view === "journal" ? (
                    (() => {
                      const entries = notes
                        .filter(
                          (n) =>
                            n.kind ===
                              (view === "notes" ? "NOTE" : "JOURNAL") &&
                            matchesNote(n.id),
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
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={create}
                          >
                            {t(view === "journal" ? "todayJournal" : "newNote")}
                          </Button>
                        </div>
                      );
                    })()
                  ) : view === "trash" ? (
                    <TrashRoute
                      snapshot={snapshot}
                      runtime={runtime}
                      query={query}
                      busy={busy}
                      run={run}
                    />
                  ) : view === "focus" ? (
                    focus.filter((i) => matches(i.id)).length ? (
                      <TaskList
                        items={focus.filter((i) => matches(i.id))}
                        {...workProps}
                        compact
                      />
                    ) : (
                      <div className="empty-state">
                        <Target size={30} />
                        <h2>{t("focusEmpty")}</h2>
                        <p>{t("focusEmptyHint")}</p>
                      </div>
                    )
                  ) : view === "tasks" ? (
                    <TasksRoute
                      presentationStore={taskPresentationStore}
                      runtime={runtime}
                      context={context}
                      snapshot={snapshot}
                      calendarTimezone={calendarTimezone}
                      projects={projects}
                      workProps={workProps}
                      visible={visible}
                      showArchived={showArchived}
                      status={status}
                      taskDependenciesOpen={taskDependenciesOpen}
                      onToggleDependencies={() =>
                        setTaskDependenciesOpen((open) => !open)
                      }
                      run={run}
                      onOpen={setEditor}
                    />
                  ) : visible.length ? (
                    <TaskList items={visible} {...workProps} />
                  ) : (
                    <div className="empty-state">
                      <ListTodo size={30} />
                      <h2>
                        {t(
                          taskSelection.tasks.length
                            ? "noResults"
                            : "firstTask",
                        )}
                      </h2>
                      <p>{t("tasksHint")}</p>
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => open("new")}
                      >
                        {t("newTask")}
                      </Button>
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
                <Button
                  key={next}
                  type="button"
                  aria-current={view === next ? "page" : undefined}
                  onClick={() => navigate(next)}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span>{viewLabel(next)}</span>
                </Button>
              ))}
            <Button
              type="button"
              aria-expanded={mobileNavigationOpen}
              aria-controls="workspace-navigation"
              onClick={() => {
                setMobileNavigationOpen((open) => !open);
              }}
            >
              <PanelLeft size={20} aria-hidden="true" />
              <span>{t("moreNavigation")}</span>
            </Button>
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
                  .map(({ view: next }) => ({
                    id: next,
                    label: viewLabel(next),
                  })),
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
              workflows={snapshot.workflows ?? []}
              calendarTimezone={calendarTimezone}
              onSaveRepeat={async (input) => {
                if (
                  await run(
                    () => runtime.saveTaskRecurrence(input),
                    editorPendingKey,
                  )
                )
                  setEditorState((current) =>
                    current === editor ? null : current,
                  );
              }}
              initialProjectId={creation.parentId}
              initialStartDate={creation.day}
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
                        : service.update(
                            context,
                            editor.id,
                            editor.version,
                            input,
                          ),
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
                        await run(async () => {
                          await trashWorkItem(editor);
                        }, editorPendingKey)
                      )
                        setEditorState((current) =>
                          current === editor ? null : current,
                        );
                    }
              }
            />
          )}
        </AppShell>
      </EntitySelectionContext.Provider>
    </WorkspaceWorkIndexContext.Provider>
  );
}
