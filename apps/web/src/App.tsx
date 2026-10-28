import type {
  EntityRef,
  WorkspaceNote as Note,
  Organization,
  OrganizeInput,
} from "@arclattice/application";
import {
  bodyCharacterCount,
  privateContentPolicy,
} from "@arclattice/application";
import type { LibraryFile, NotificationRecord } from "@arclattice/domain";
import {
  type ActorContext,
  DomainError,
  defaultNavigationPreference,
  localCalendarDay,
  navigationGroup,
  navigationViews,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountView, AdminView } from "./AccountViews";
import { AppUpdater } from "./AppUpdater";
import { AppShell } from "./app/AppShell";
import { CommandPalette } from "./app/CommandPalette";
import { ContextPane } from "./app/ContextPane";
import { EntitySelectionContext } from "./app/EntitySelection";
import { createTaskPresentationStore } from "./app/hooks/task-presentation-store";
import { useNotificationCenter } from "./app/hooks/useNotificationCenter";
import { useNotifications } from "./app/hooks/useNotifications";
import { usePendingOperations } from "./app/hooks/usePendingOperations";
import { useViewScroll } from "./app/hooks/useViewScroll";
import { useViewState } from "./app/hooks/useViewState";
import { useWorkspaceSync } from "./app/hooks/useWorkspaceSync";
import { createViewStore } from "./app/hooks/view-store";
import { NotificationBell } from "./app/NotificationCenter";
import {
  currentView,
  type NavigationView,
  navigation,
  SIDEBAR_COLLAPSED_KEY,
  type View,
} from "./app/navigation";
import {
  PageHeader,
  ShellActions,
  ShellActionsProvider,
} from "./app/PageHeader";
import { AtlasRoute } from "./app/routes/AtlasRoute";
import { CalendarRoute } from "./app/routes/CalendarRoute";
import { GraphRoute } from "./app/routes/GraphRoute";
import { SettingsRoute } from "./app/routes/SettingsRoute";
import { TasksRoute } from "./app/routes/TasksRoute";
import { TrashRoute } from "./app/routes/TrashRoute";
import { Sidebar } from "./app/Sidebar";
import { StartupShell } from "./app/StartupShell";
import { SyncStatus } from "./app/SyncStatus";
import { showToast, ToastHost } from "./app/ToastHost";
import { WorkspaceRouter } from "./app/WorkspaceRouter";
import { type Runtime, readPreference, savePreference } from "./bootstrap";
import { Button, Toolbar } from "./components/ui/Button";
import { confirmAction } from "./components/ui/ConfirmationHost";
import { Popover, Select } from "./components/ui/Surfaces";
import { DocumentWorkspace, type WorkspaceRequest } from "./DocumentWorkspace";
import { AssistantPane } from "./features/ai/AssistantPane";
import { AtlasFloatingSurface } from "./features/ai/AtlasFloatingSurface";
import { parseConversationRoute } from "./features/ai/conversation-route";
import { FileLinkContext } from "./features/files/FileLinkContext";
import { FilesWorkspace } from "./features/files/FilesWorkspace";
import { parseFileHash } from "./features/files/fileRoute";
import { useFileNavigation } from "./features/files/useFileNavigation";
import { PickerIdentityContext } from "./features/hierarchy/PickerIdentityContext";
import { CreateSpaceDialog } from "./features/knowledge/CreateSpaceDialog";
import { EntityMemo, WorkEntityMemo } from "./features/memos/EntityMemo";
import { MoreSheet } from "./features/mobile/MoreSheet";
import { FolderTree } from "./features/notes/FolderTree";
import {
  folderCounts,
  folderKey,
  folderPath,
  legacyFolderGroups,
  noteFolderKey,
  noteFolderLabel,
} from "./features/notes/folder-model";
import { NoteBrowser } from "./features/notes/NoteBrowser";
import { useNotePresentation } from "./features/notes/useNotePresentation";
import { ProjectDrilldownPicker } from "./features/projects/ProjectDrilldownPicker";
import type { TaskPresentation } from "./features/tasks/TasksWorkspace";
import { selectTasks } from "./features/tasks/task-selectors";
import { taskPresentationComparator } from "./features/tasks/task-sort";
import {
  type TaskTimerAction,
  TaskTimerContext,
} from "./features/tasks/task-timer";
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
      <Workbench
        runtime={runtime}
        context={context}
        onLogout={() => {
          setContext(runtime.context);
        }}
      />
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
  const [atlasRouteStore] = useState(() =>
    createViewStore(parseConversationRoute(location.hash)),
  );
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => {
    const open = () => setAssistantOpen(true);
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
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
    kind?: "ALL" | "DOCUMENT" | "FILE";
    fileType?: "ALL" | "PDF" | "TABLE" | "SLIDES" | "IMAGE" | "OTHER";
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
    useState<WorkspaceRequest | null>(null);
  const [documentVisible, setDocumentVisible] = useState(false);
  const [activeDocumentContext, setActiveDocumentContext] =
    useState<WorkspaceRequest | null>(null);
  // DocumentWorkspace owns dirty indicators. The shell only reads this flag
  // when guarding an action; typing must not re-render the whole workbench.
  const documentDirty = useRef(false);
  const setDocumentDirty = useCallback((dirty: boolean) => {
    documentDirty.current = dirty;
  }, []);
  const [creatingSpace, setCreatingSpace] = useState(false);
  function openDocument(request: WorkspaceRequest) {
    if (request.kind === "SPACE" && !request.entity) {
      setCreatingSpace(true);
      return;
    }
    setDocumentRequest({
      ...request,
      ...(activeProjectId ? { projectId: activeProjectId } : {}),
    });
    setDocumentVisible(true);
  }
  const [error, setError] = useState<string | null>(null);
  const {
    snapshot,
    setSnapshot,
    loading,
    syncOffline,
    refresh,
    attentionTick,
  } = useWorkspaceSync(runtime, setError);
  const openFileRequest = useCallback((file: LibraryFile) => {
    setDocumentRequest({
      key: `FILE:${file.id}`,
      kind: "FILE",
      file,
      spaceId: file.spaceId,
    });
    setDocumentVisible(true);
  }, []);
  const openFileLink = useFileNavigation(snapshot.files ?? [], openFileRequest);
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
  const [notePresentation, setNotePresentation] = useNotePresentation(
    view === "journal",
  );
  const [folderFilter, setFolderFilter] = useViewState<string | null>(
    view,
    null,
  );
  const [moveTargetFolder, setMoveTargetFolder] = useState("");
  const workIndex = useMemo(
    () => buildWorkspaceWorkIndex(snapshot.items, snapshot.organization ?? []),
    [snapshot.items, snapshot.organization],
  );
  const { archiveSource, isArchived } = workIndex;
  const organization = (kind: "WORK" | "NOTE", id: string) =>
    workIndex.organizationByKey.get(`${kind}:${id}`);
  async function organize(input: OrganizeInput) {
    if (
      documentDirty.current ||
      libraryDraft.current ||
      projectBriefDirty.current
    ) {
      showToast(t("saveBeforeOrganize"));
      return;
    }
    if (
      await run(async () => {
        await runtime.organize(input);
        if (input.action === "delete")
          showToast(t("movedToTrash"), async () => {
            const current = await runtime.loadWorkspace();
            for (const entry of input.entries ?? []) {
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
  const folderEntry = (folder: Organization) => ({
    id: folder.id,
    version: folder.version,
    organizationVersion: folder.version,
  });
  async function createFolder(
    parentId: string,
    name: string,
  ): Promise<boolean> {
    const trimmed = name.trim();
    const existing = activeFolders.find(
      (folder) =>
        (folder.parentId ?? "") === parentId && folder.name === trimmed,
    );
    if (existing) {
      setFolderFilter(folderKey(existing.id));
      return true;
    }
    return run(
      () =>
        runtime.organize({
          kind: "FOLDER",
          action: "create",
          id: crypto.randomUUID(),
          name,
          parentId,
        }),
      "folder:create",
    );
  }
  async function renameFolder(
    folder: Organization,
    name: string,
  ): Promise<boolean> {
    return run(
      () =>
        runtime.organize({
          kind: "FOLDER",
          action: "rename",
          name,
          entries: [folderEntry(folder)],
        }),
      "folder:rename:" + folder.id,
    );
  }
  async function moveFolder(
    folder: Organization,
    parentId: string,
  ): Promise<boolean> {
    return run(
      () =>
        runtime.organize({
          kind: "FOLDER",
          action: "move",
          parentId,
          entries: [folderEntry(folder)],
        }),
      "folder:move:" + folder.id,
    );
  }
  async function deleteFolder(folder: Organization): Promise<boolean> {
    const referenced = snapshot.notes.some(
      (note) =>
        organizationByKey.get("NOTE:" + note.id)?.folderId === folder.id,
    );
    if (
      referenced ||
      folderRows.some((entry) => entry.parentId === folder.id)
    ) {
      showToast(t("folderNotEmpty"));
      return false;
    }
    return run(
      () =>
        runtime.organize({
          kind: "FOLDER",
          action: "delete",
          entries: [folderEntry(folder)],
        }),
      "folder:delete:" + folder.id,
    );
  }
  async function restoreFolder(folder: Organization): Promise<boolean> {
    return run(
      () =>
        runtime.organize({
          kind: "FOLDER",
          action: "unarchive",
          entries: [folderEntry(folder)],
        }),
      "folder:restore:" + folder.id,
    );
  }
  function noteIcon(note: Note): string {
    return organizationByKey.get("NOTE:" + note.id)?.icon ?? "";
  }
  async function setNoteIcon(note: Note, icon: string): Promise<boolean> {
    const entry = organizationByKey.get("NOTE:" + note.id);
    return run(
      () =>
        runtime.organize({
          kind: "NOTE",
          action: "icon",
          icon,
          entries: [
            {
              id: note.id,
              version: note.version,
              organizationVersion: entry?.version ?? 0,
            },
          ],
        }),
      "note:icon:" + note.id,
    );
  }
  async function setFolderIcon(
    folder: Organization,
    icon: string,
  ): Promise<boolean> {
    return run(
      () =>
        runtime.organize({
          kind: "FOLDER",
          action: "icon",
          icon,
          entries: [folderEntry(folder)],
        }),
      "folder:icon:" + folder.id,
    );
  }
  async function createNoteInFolder(folderId: string | null) {
    void run(async () => {
      const created = await runtime.saveNote(null, 0, {
        kind: "NOTE",
        day: null,
        title: t("untitledNote"),
        bodyMd: "",
        aiPolicy: privateContentPolicy,
      });
      if (folderId)
        await runtime.organize({
          kind: "NOTE",
          action: "move",
          folderId,
          entries: [
            {
              id: created.id,
              version: created.version,
              organizationVersion: 0,
            },
          ],
        });
      openNote(created);
    });
  }
  async function convertLegacyFolders() {
    try {
      const entries = notes.filter((note) => note.kind === "NOTE");
      const groups = legacyFolderGroups(entries, organizationByKey);
      for (const group of groups) {
        const existing = activeFolders.find(
          (folder) =>
            (folder.parentId ?? "") === "" && folder.name === group.name,
        );
        const folderId = existing?.id ?? crypto.randomUUID();
        if (!existing)
          await runtime.organize({
            kind: "FOLDER",
            action: "create",
            id: folderId,
            name: group.name,
            parentId: "",
          });
        for (let offset = 0; offset < group.noteIds.length; offset += 100) {
          const batch = group.noteIds.slice(offset, offset + 100);
          const moves = batch.flatMap((id) => {
            const note = snapshot.notes.find((entry) => entry.id === id);
            const entry = organizationByKey.get("NOTE:" + id);
            return note
              ? [
                  {
                    id,
                    version: note.version,
                    organizationVersion: entry?.version ?? 0,
                  },
                ]
              : [];
          });
          if (moves.length)
            await runtime.organize({
              kind: "NOTE",
              action: "move",
              folderId,
              entries: moves,
            });
        }
      }
      await refresh();
      if (groups.length) showToast(t("legacyFoldersConverted"));
    } catch (cause) {
      setError(errorCode(cause));
    }
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
  const [editorIntent, setEditorIntent] = useState<"EDIT" | "LIFECYCLE">(
    "EDIT",
  );
  const setEditor = (
    next: WorkItem | "new" | null,
    intent: "EDIT" | "LIFECYCLE" = "EDIT",
  ) => {
    const apply = () => {
      setEditorIntent(intent);
      setEditorState(next);
    };
    if (next && editor && (next !== editor || intent !== editorIntent)) {
      const change = new CustomEvent("atlas:task-detail-change", {
        cancelable: true,
        detail: apply,
      });
      if (!window.dispatchEvent(change)) return;
    }
    apply();
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
      if (parseFileHash(location.hash)) {
        acceptedHash.current = location.hash;
        return;
      }
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
      const nextView = currentView();
      const withinAtlas =
        nextView === "ai" && acceptedHash.current.split("?")[0] === "#ai";
      acceptedHash.current = location.hash;
      atlasRouteStore.set(parseConversationRoute(location.hash));
      if (withinAtlas) {
        if (parseConversationRoute(location.hash)) setDocumentVisible(false);
        return;
      }
      setProjectRoute((previous) =>
        previous.projectId === nextProject.projectId &&
        previous.tab === nextProject.tab &&
        previous.scope === nextProject.scope
          ? previous
          : nextProject,
      );
      if (nextProject.projectId) void refresh().catch(() => undefined);
      if (nextView === "ai" && parseConversationRoute(location.hash))
        setDocumentVisible(false);
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
    if (acceptedHash.current !== location.hash) void listener();
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
        if (view === "notes" || view === "files") setNoteEditor("NOTE");
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
        if (view === "notes" || view === "files") setNoteEditor("NOTE");
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
  async function timerTask(item: WorkItem, action: TaskTimerAction) {
    return run(
      () => service.update(context, item.id, item.version, { timer: action }),
      "timer:" + item.id,
    );
  }
  function reorderNavigation(
    moving: string,
    anchor: string,
    placement: "BEFORE" | "AFTER",
  ) {
    const movingId = navigationViews.find((id) => id === moving);
    const anchorId = navigationViews.find((id) => id === anchor);
    if (!movingId || !anchorId) return;
    void run(
      () =>
        service.moveNavigationPreference(context, {
          version: navigationPreference.version,
          movingId,
          anchorId,
          placement,
        }),
      "navigation-order",
    );
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
  const organizationRows = useMemo(
    () => snapshot.organization ?? [],
    [snapshot.organization],
  );
  const folderRows = useMemo(
    () => organizationRows.filter((entry) => entry.kind === "FOLDER"),
    [organizationRows],
  );
  const activeFolders = useMemo(
    () => folderRows.filter((folder) => !folder.archived),
    [folderRows],
  );
  const organizationByKey = workIndex.organizationByKey;
  const folderOptions = useMemo(
    () =>
      activeFolders
        .map((folder) => ({
          value: folderKey(folder.id),
          label: folderPath(folder.id, folderRows),
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [activeFolders, folderRows],
  );
  const noteFolderKeyOf = (note: Note) =>
    noteFolderKey(note, organizationByKey);
  const noteFolderLabelOf = (note: Note) =>
    noteFolderLabel(
      note,
      organizationByKey,
      folderRows,
      t("unfiled"),
      t("legacyFolder"),
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
  const notifications = useNotifications(runtime, context);
  const notificationCenter = useNotificationCenter(
    runtime,
    snapshot,
    calendarDay,
    i18n.language.startsWith("zh") ? "zh-CN" : "en-US",
    loading,
    notifications.enabled,
    attentionTick,
  );
  function openNotificationRoute(route: string) {
    // Routes are application-relative: "/<view>/<id>". Unknown views fall back to overview.
    const [, segment, id] = route.split("/");
    if ((segment === "tasks" || segment === "milestones") && id)
      return openEntity({ kind: "WORK", id });
    if (segment === "projects" && id) return void navigateProject(id);
    if (segment === "files" && id) return openEntity({ kind: "FILE", id });
    const target = navigation.find((entry) => entry.view === segment);
    void navigate(target ? target.view : "overview");
  }
  function openNotificationTarget(record: NotificationRecord) {
    const { kind, id, route } = record.target;
    if ((kind === "TASK" || kind === "MILESTONE") && id)
      return openEntity({ kind: "WORK", id });
    if (kind === "PROJECT" && id) return void navigateProject(id);
    if (kind === "FILE" && id) return openEntity({ kind: "FILE", id });
    openNotificationRoute(route);
  }
  // Latest handler without resubscribing; taps must work after startup hydration.
  const notificationRouteHandler = useRef(openNotificationRoute);
  notificationRouteHandler.current = openNotificationRoute;
  useEffect(() => {
    if (loading) return;
    return runtime.subscribeNotificationOpen((route) =>
      notificationRouteHandler.current(route),
    );
  }, [runtime, loading]);
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
  const executionActiveIds = useMemo(
    () => new Set(displayedTasks.activeIds),
    [displayedTasks.activeIds],
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
    if (
      !normalizedQuery ||
      (view !== "notes" && view !== "journal" && view !== "files")
    )
      return;
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
  const workspaceTaskOrder = useMemo(
    () =>
      snapshot.manualOrders?.find((state) => state.id === "WORKSPACE_TASKS"),
    [snapshot.manualOrders],
  );
  const manualPositions = useMemo(
    () =>
      new Map(
        workspaceTaskOrder?.entries.map((entry) => [
          entry.entityId,
          entry.position,
        ]) ?? [],
      ),
    [workspaceTaskOrder],
  );
  const visible = useMemo(
    () =>
      view === "ai" || view === "graph"
        ? []
        : displayedTasks.tasks
            .filter(
              (item) =>
                item.type === "TASK" &&
                (activationFilter === "ALL" ||
                  executionActiveIds.has(item.id) ===
                    (activationFilter === "ACTIVE")) &&
                (!normalizedQuery ||
                  (searchTextById.get(item.id)?.includes(normalizedQuery) ??
                    false)) &&
                ((view === "tasks" &&
                  (status === "ALL" || status === "UNFINISHED")) ||
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
            .sort(
              taskPresentationComparator(sort, i18n.language, manualPositions),
            ),
    [
      displayedTasks.tasks,
      activationFilter,
      executionActiveIds,
      normalizedQuery,
      searchTextById,
      view,
      status,
      priority,
      projectFilter,
      projectMemberIds,
      sort,
      manualPositions,
      i18n.language,
    ],
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
    if (ref.kind === "FILE") {
      openFileLink(ref.id);
    } else if (ref.kind === "WORK") {
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
    if (view === "notes" || view === "files") openNote("NOTE");
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
          showToast(
            t(next === "DONE" ? "common:taskCompleted" : "common:taskReopened"),
            async () => {
              await service.update(context, updated.id, updated.version, {
                status: item.status,
              });
              await refresh();
            },
          );
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
    manualOrder:
      view === "tasks" && sort === "manual"
        ? {
            scopeKey: "WORKSPACE_TASKS",
            pending: isPending("manual-order:WORKSPACE_TASKS"),
            move: (
              entityId: string,
              anchorId: string,
              placement: "BEFORE" | "AFTER",
            ) => {
              void run(
                () =>
                  runtime.moveManualOrder({
                    scope: { kind: "WORKSPACE_TASKS" },
                    version: workspaceTaskOrder?.version ?? 0,
                    entityId,
                    anchorId,
                    placement,
                  }),
                "manual-order:WORKSPACE_TASKS",
              );
            },
          }
        : undefined,
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
  const effectiveFolderFilter =
    folderFilter &&
    !folderFilter.startsWith("folder:") &&
    !folderFilter.startsWith("legacy:")
      ? "legacy:" + folderFilter
      : folderFilter;
  const folderTree = (allEntries: Note[]) =>
    view === "journal" ? undefined : (
      <FolderTree
        folders={folderRows}
        notes={allEntries.filter((note) => note.kind === "NOTE")}
        counts={folderCounts(allEntries, organizationByKey)}
        legacy={legacyFolderGroups(allEntries, organizationByKey)}
        selected={effectiveFolderFilter}
        busy={busy}
        onSelect={setFolderFilter}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onMoveFolder={moveFolder}
        onDeleteFolder={deleteFolder}
        onRestoreFolder={restoreFolder}
        onIconFolder={setFolderIcon}
        onCreateNote={(folderId) => void createNoteInFolder(folderId)}
        onConvertLegacy={convertLegacyFolders}
      />
    );
  const noteCards = (allEntries: Note[]) => (
    <div className={view === "journal" ? "note-browser-standalone" : undefined}>
      <NoteBrowser
        entries={allEntries}
        journal={view === "journal"}
        presentation={notePresentation}
        onPresentation={setNotePresentation}
        folderFilter={effectiveFolderFilter}
        onFolderFilter={setFolderFilter}
        folderOptions={folderOptions}
        getFolderKey={noteFolderKeyOf}
        getFolderLabel={noteFolderLabelOf}
        getIcon={noteIcon}
        onIcon={(note, icon) => void setNoteIcon(note, icon)}
        folderPanel={folderTree(allEntries)}
        selectedIds={selectedNotes}
        onSelection={setSelectedNotes}
        pending={busy}
        searching={Boolean(query.trim())}
        date={date}
        onOpen={openNote}
        onInspect={(note) => {
          setSelectedEntity({ kind: "NOTE", id: note.id });
          setAssistantOpen(false);
        }}
        onDelete={(note) =>
          void run(async () => {
            const deleted = await runtime.deleteNote(
              note.id,
              note.version,
              true,
            );
            showToast(t("movedToTrash"), async () => {
              await runtime.deleteNote(deleted.id, deleted.version, false);
              await refresh();
            });
          })
        }
        selectionActions={
          <>
            {selectedNotes.length > 0 && (
              <>
                <Select
                  aria-label={t("destinationFolder")}
                  value={moveTargetFolder}
                  onChange={(event) => setMoveTargetFolder(event.target.value)}
                >
                  <option value="">{t("unfiled")}</option>
                  {activeFolders
                    .map((folder) => ({
                      value: folder.id,
                      label: folderPath(folder.id, folderRows),
                    }))
                    .sort((left, right) =>
                      left.label.localeCompare(right.label),
                    )
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void organize({
                      kind: "NOTE",
                      action: "move",
                      folderId: moveTargetFolder,
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
          </>
        }
      />
    </div>
  );
  const pageCrumbs =
    view === "projects" &&
    activeProjectId &&
    workIndex.projectsById.has(activeProjectId)
      ? [
          {
            id: "projects",
            label: viewLabel("projects"),
            onActivate: () => void navigate("projects"),
          },
          ...(workIndex.ancestorIdsByProjectId.get(activeProjectId) ?? [])
            .slice()
            .reverse()
            .map((id) => ({
              id,
              label: workIndex.projectsById.get(id)!.title,
              onActivate: () => void navigateProject(id),
            })),
          {
            id: activeProjectId,
            label: workIndex.projectsById.get(activeProjectId)!.title,
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
        : [];
  // List pages render their own PageHeader inline (search/count); graph and the
  // editor own their chrome. Everything else uses the shared header above the page.
  const ownsSharedHeader = !(
    [
      "tasks",
      "notes",
      "journal",
      "files",
      "trash",
      "focus",
      "graph",
      "ai",
    ] as string[]
  ).includes(view);
  const createAction = !(
    [
      "graph",
      "settings",
      "trash",
      "ai",
      "library",
      "account",
      "admin",
    ] as string[]
  ).includes(view) ? (
    <Button
      variant={view === "projects" && activeProjectId ? "ghost" : "primary"}
      className="compact-create"
      type="button"
      disabled={busy || loading}
      onClick={create}
    >
      <Plus size={17} />
      {t(
        view === "notes" || view === "files"
          ? "newNote"
          : view === "journal"
            ? "todayJournal"
            : view === "projects"
              ? "newProject"
              : "newTask",
      )}
    </Button>
  ) : null;
  const shellActions = (
    <>
      <SyncStatus
        loading={loading}
        offline={syncOffline}
        onRetry={() => void refresh()}
      />
      <NotificationBell
        records={notificationCenter.records}
        unread={notificationCenter.unread}
        error={notificationCenter.error}
        onOpen={openNotificationTarget}
        onRead={notificationCenter.markRead}
        onUnread={notificationCenter.markUnread}
        onDismiss={notificationCenter.dismiss}
        onSnooze={notificationCenter.snooze}
      />
    </>
  );
  const assistantDocument = documentVisible
    ? (activeDocumentContext?.entity ?? null)
    : null;
  return (
    <PrivateImageContext.Provider value={runtime.loadImage}>
      <ShellActionsProvider value={shellActions}>
        <WorkspaceWorkIndexContext.Provider value={workIndex}>
          <FileLinkContext.Provider value={openFileLink}>
            <EntitySelectionContext.Provider
              value={{
                selected: selectedEntity,
                select: (ref) => {
                  setSelectedEntity(ref);
                  setAssistantOpen(false);
                },
              }}
            >
              <TaskTimerContext.Provider value={timerTask}>
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
                        else if (kind === "NOTE" || kind === "JOURNAL")
                          openNote(kind);
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
                            openDocument({
                              key: entity.id,
                              kind: entity.kind,
                              entity,
                            });
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
                  {selectedEntity &&
                    !assistantOpen &&
                    !documentVisible &&
                    !(
                      view === "projects" &&
                      selectedEntity.kind === "WORK" &&
                      selectedEntity.id === activeProjectId
                    ) &&
                    !editor && (
                      <ContextPane
                        memo={
                          selectedEntity.kind === "WORK" ? (
                            <WorkEntityMemo
                              runtime={runtime}
                              item={workIndex.itemsById.get(selectedEntity.id)}
                            />
                          ) : undefined
                        }
                        selected={selectedEntity}
                        snapshot={snapshot}
                        onClose={() => setSelectedEntity(null)}
                        onOpen={(ref) => {
                          const item =
                            ref.kind === "WORK"
                              ? workIndex.itemsById.get(ref.id)
                              : undefined;
                          if (item?.type === "PROJECT")
                            void navigateProject(item.id);
                          else openEntity(ref);
                        }}
                      />
                    )}
                  {assistantOpen && !editor && (
                    <AtlasFloatingSurface
                      zh={i18n.language.startsWith("zh")}
                      label={
                        i18n.language.startsWith("zh")
                          ? "Atlas 助手"
                          : "Atlas assistant"
                      }
                      onClose={() => setAssistantOpen(false)}
                    >
                      <AssistantPane
                        hosted
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
                    </AtlasFloatingSurface>
                  )}
                  <Sidebar
                    collapsed={sidebarCollapsed}
                    onToggleCollapsed={toggleSidebar}
                    mobileOpen={mobileNavigationOpen}
                    canAdmin={runtime.account?.role === "ADMIN"}
                    activeView={view}
                    navigationOrder={navigationOrder}
                    pinnedNavigation={navigationPreference.desktop.pinned}
                    reorderPending={isPending("navigation-order")}
                    onReorder={reorderNavigation}
                    taskCount={count(taskSelection.openActiveTasks.length)}
                    noteCount={count(
                      notes.filter((note) => note.kind === "NOTE").length,
                    )}
                    label={viewLabel}
                    onNavigate={navigate}
                    onToggleMobile={() =>
                      setMobileNavigationOpen((value) => !value)
                    }
                    onLogout={async () => {
                      if (
                        (documentDirty.current ||
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
                      {ownsSharedHeader && (
                        <PageHeader
                          title={viewLabel(view)}
                          path={pageCrumbs}
                          actions={createAction}
                        />
                      )}
                      {view === "graph" && (
                        <GraphRoute
                          active={!documentVisible}
                          scopeKey={`${runtime.serverOrigin}|${runtime.context.workspaceId}|${runtime.context.principalId}`}
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
                        notificationCenter={notificationCenter}
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
                              service.setNavigationPreference(
                                context,
                                preference,
                              ),
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
                              service.setCalendarSettings(
                                context,
                                version,
                                timezone,
                              ),
                            ),
                        }}
                        onLogout={async () => {
                          void (
                            (documentDirty.current ||
                              libraryDraft.current ||
                              editor) &&
                            !(await confirmAction(t("discardHint")))
                              ? Promise.resolve(false)
                              : run(() => runtime.logout())
                          ).then((ok) => {
                            if (ok) onLogout();
                          });
                        }}
                        onOpenAccount={() => void navigate("account")}
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
                          snapshot={snapshot}
                          onLogout={onLogout}
                          confirmLeave={async () =>
                            !(
                              documentDirty.current ||
                              libraryDraft.current ||
                              editor
                            ) || (await confirmAction(t("discardHint")))
                          }
                        />
                      ) : view === "admin" ? (
                        <AdminView runtime={runtime} />
                      ) : view === "ai" ? (
                        <>
                          <AtlasRoute
                            workspaceActions={<ShellActions />}
                            viewStore={atlasRouteStore}
                            onSource={openEntity}
                            snapshot={snapshot}
                            runtime={runtime}
                            context={[]}
                            embedded
                            onClose={() => {}}
                          />
                        </>
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
                                <TaskList
                                  items={focus.slice(0, 5)}
                                  {...workProps}
                                />
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
                                      (n) =>
                                        n.kind === "JOURNAL" && n.day === day,
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
                                        (done.length /
                                          taskSelection.tasks.length) *
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
                              onTaskPresentationChange={
                                setProjectTaskPresentation
                              }
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
                                  service.update(
                                    context,
                                    base.id,
                                    base.version,
                                    {
                                      descriptionMd: markdown,
                                    },
                                  ),
                                )
                              }
                              runtime={runtime}
                              run={(operation) =>
                                run(
                                  operation,
                                  "project:" + projectRoute.projectId,
                                )
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
                              onLifecycle={(project) =>
                                setEditor(project, "LIFECYCLE")
                              }
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
                                onReviewWorkspace={() =>
                                  void navigate("account")
                                }
                                onReparent={(movingId, parentProjectId) => {
                                  const moving = projects.find(
                                    (project) => project.id === movingId,
                                  );
                                  if (moving)
                                    void run(
                                      () =>
                                        service.update(
                                          context,
                                          moving.id,
                                          moving.version,
                                          { parentProjectId },
                                        ),
                                      "project-manipulation",
                                    );
                                }}
                                onMoveCategory={(movingId, categoryId) => {
                                  const moving = projects.find(
                                    (project) => project.id === movingId,
                                  );
                                  if (moving)
                                    void run(
                                      () =>
                                        service.update(
                                          context,
                                          moving.id,
                                          moving.version,
                                          { categoryId },
                                        ),
                                      "project-manipulation",
                                    );
                                }}
                                manualOrders={snapshot.manualOrders ?? []}
                                onMoveSibling={(
                                  parentProjectId,
                                  entityId,
                                  anchorId,
                                  placement,
                                ) => {
                                  const scope = {
                                    kind: "PROJECT_CHILDREN" as const,
                                    parentProjectId,
                                  };
                                  const order = snapshot.manualOrders?.find(
                                    (entry) =>
                                      entry.scope.kind === "PROJECT_CHILDREN" &&
                                      entry.scope.parentProjectId ===
                                        parentProjectId,
                                  );
                                  void run(
                                    () =>
                                      runtime.moveManualOrder({
                                        scope,
                                        version: order?.version ?? 0,
                                        entityId,
                                        anchorId,
                                        placement,
                                      }),
                                    "project-manipulation",
                                  );
                                }}
                                onEdit={workProps.onOpen}
                                categories={snapshot.categories ?? []}
                                onSaveCategory={(input) =>
                                  run(() => runtime.saveCategory(input))
                                }
                                onReorderCategories={(ordered) =>
                                  run(() => runtime.reorderCategories(ordered))
                                }
                                projects={projects}
                                items={allItems}
                                busy={isPending("project-manipulation")}
                                isArchived={isArchived}
                                archiveSource={archiveSource}
                                onOrganize={workProps.onOrganize}
                                onOpen={(project) =>
                                  navigateProject(project.id)
                                }
                                onTasks={(id) => {
                                  navigate("tasks");
                                  setProjectFilterForView("tasks", id);
                                  const project = projects.find(
                                    (p) => p.id === id,
                                  );
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
                                  run(() =>
                                    runtime.previewPlan(projectId, manifest),
                                  )
                                }
                                publish={(id, version) =>
                                  run(() => runtime.publishPlan(id, version))
                                }
                                save={(input) =>
                                  run(() => runtime.saveRecurrence(input))
                                }
                                generate={(id, version, from, to) =>
                                  run(() =>
                                    runtime.generateRecurrence(
                                      id,
                                      version,
                                      from,
                                      to,
                                    ),
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
                            setCreation({
                              type: "TASK",
                              parentId: "",
                              day: date,
                            });
                            setEditor("new");
                          }}
                          pickerItems={allItems}
                          reminders={snapshot.reminders ?? []}
                          onSaveReminder={(id, version, input, deleted) =>
                            run(
                              () =>
                                runtime.saveReminder(
                                  id,
                                  version,
                                  input,
                                  deleted,
                                ),
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
                          <PageHeader
                            title={t(view)}
                            meta={
                              <span
                                className="view-count-badge"
                                hidden={view === "tasks" || view === "files"}
                              >
                                {count(
                                  view === "files"
                                    ? notes.filter(
                                        (note) => note.kind === "NOTE",
                                      ).length +
                                        snapshot.library.filter(
                                          (entry) =>
                                            entry.kind === "DOCUMENT" &&
                                            !entry.deletedAt,
                                        ).length +
                                        (snapshot.files ?? []).filter(
                                          (file) => !file.deletedAt,
                                        ).length
                                    : view === "notes" || view === "journal"
                                      ? notes.filter(
                                          (n) =>
                                            n.kind ===
                                            (view === "journal"
                                              ? "JOURNAL"
                                              : "NOTE"),
                                        ).length
                                      : view === "trash"
                                        ? snapshot.items.filter(
                                            (i) => i.deletedAt,
                                          ).length +
                                          snapshot.notes.filter(
                                            (n) => n.deletedAt,
                                          ).length
                                        : view === "focus"
                                          ? focus.length
                                          : visible.length,
                                )}
                              </span>
                            }
                            search={
                              <label className="search">
                                <Search size={16} />
                                <input
                                  ref={search}
                                  aria-label={t("search")}
                                  placeholder={t("search")}
                                  value={query}
                                  onChange={(event) =>
                                    setQuery(event.target.value)
                                  }
                                />
                                <kbd>/</kbd>
                              </label>
                            }
                            actions={createAction}
                          />
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
                                          typeof value === "string"
                                            ? value
                                            : "ALL",
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
                                    onChange={(event) =>
                                      setSort(event.target.value)
                                    }
                                  >
                                    <option value="updated">
                                      {t("recentlyUpdated")}
                                    </option>
                                    {view === "tasks" && (
                                      <option value="manual">
                                        {i18n.language.startsWith("zh")
                                          ? "自定义顺序"
                                          : "Custom order"}
                                      </option>
                                    )}
                                    <option value="due">
                                      {i18n.language.startsWith("zh")
                                        ? "截止时间"
                                        : "Due date"}
                                    </option>
                                    <option value="priority">
                                      {t("priority")}
                                    </option>
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
                                    onDismiss={() =>
                                      setAdvancedFiltersOpen(false)
                                    }
                                  >
                                    {" "}
                                    {view === "tasks" && (
                                      <label>
                                        <span>{t("activationState")}</span>
                                        <Select
                                          aria-label={t("activationState")}
                                          value={activationFilter}
                                          onChange={(event) =>
                                            setActivationFilter(
                                              event.target.value,
                                            )
                                          }
                                        >
                                          <option value="ALL">
                                            {t("all")}
                                          </option>
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
                          {view === "files" ? (
                            <FilesWorkspace
                              notes={notes}
                              library={snapshot.library}
                              fileEntries={snapshot.files ?? []}
                              folderPanel={folderTree(notes)}
                              folderFilter={effectiveFolderFilter}
                              query={query}
                              busy={busy}
                              getFolderKey={noteFolderKeyOf}
                              getFolderLabel={noteFolderLabelOf}
                              getIcon={noteIcon}
                              onIcon={(note, icon) =>
                                void setNoteIcon(note, icon)
                              }
                              onOpenNote={openNote}
                              onOpenResource={openEntity}
                              onUpload={(file) =>
                                run(async () => {
                                  const uploaded = await runtime.uploadFile(
                                    {
                                      name: file.name,
                                      spaceId: null,
                                      mime:
                                        file.type || "application/octet-stream",
                                    },
                                    file,
                                  );
                                  openFileLink(uploaded.id);
                                })
                              }
                            />
                          ) : view === "notes" || view === "journal" ? (
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
                              return entries.length ||
                                (view === "notes" && activeFolders.length) ? (
                                noteCards(entries)
                              ) : (
                                <div className="empty-state">
                                  <BookOpen size={30} />
                                  <h2>
                                    {t(query ? "noResults" : "captureThought")}
                                  </h2>
                                  <p>{t("notesHint")}</p>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={create}
                                  >
                                    {t(
                                      view === "journal"
                                        ? "todayJournal"
                                        : "newNote",
                                    )}
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
                          runtime.account?.role === "ADMIN",
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
                      onReorder={reorderNavigation}
                      reorderPending={isPending("navigation-order")}
                      entries={[
                        ...[...navigation]
                          .sort(
                            (a, b) =>
                              navigationOrder.indexOf(a.view) -
                              navigationOrder.indexOf(b.view),
                          )
                          .filter(
                            ({ view: next }) =>
                              !navigationPreference.mobile.pinned.includes(
                                next,
                              ),
                          )
                          .filter(
                            ({ view: next }) =>
                              next !== "admin" ||
                              runtime.account?.role === "ADMIN",
                          )
                          .map(({ view: next }) => ({
                            id: next,
                            label: viewLabel(next),
                            ...(!navigationPreference.desktop.hidden.includes(
                              next,
                            ) && navigationGroup(next)
                              ? {
                                  scopeKey: `NAV:${navigationGroup(next)}:${navigationPreference.desktop.pinned.includes(next) ? "pinned" : "ordinary"}`,
                                }
                              : {}),
                          })),
                        { id: "settings", label: viewLabel("settings") },
                      ]}
                      onNavigate={(next) => navigate(next as View)}
                      onClose={() => setMobileNavigationOpen(false)}
                    />
                  )}
                  {creatingSpace && (
                    <CreateSpaceDialog
                      runtime={runtime}
                      onClose={() => setCreatingSpace(false)}
                      onCreated={(space) => {
                        setCreatingSpace(false);
                        setLibraryViewState((current) => ({
                          ...current,
                          spaceId: space.id,
                          query: "",
                        }));
                        setDocumentVisible(false);
                        navigate("library");
                        void refresh();
                      }}
                    />
                  )}
                  {editor && (
                    <WorkItemEditor
                      memo={
                        editor === "new" ||
                        (editor.type !== "PROJECT" &&
                          editor.type !== "TASK" &&
                          editor.type !== "MILESTONE") ? undefined : (
                          <EntityMemo
                            runtime={runtime}
                            targetKind={editor.type}
                            targetId={editor.id}
                          />
                        )
                      }
                      intent={editorIntent}
                      key={
                        (editor === "new"
                          ? "new"
                          : editor.id + "-" + editor.version) +
                        "-" +
                        editorIntent
                      }
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
              </TaskTimerContext.Provider>
            </EntitySelectionContext.Provider>
          </FileLinkContext.Provider>
        </WorkspaceWorkIndexContext.Provider>
      </ShellActionsProvider>
    </PrivateImageContext.Provider>
  );
}
