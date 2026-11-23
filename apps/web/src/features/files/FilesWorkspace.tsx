import {
  type EntityRef,
  type ProjectMaterial,
  type ResourceFolderSource,
  selectResourceCatalog,
  type WorkspaceLibraryEntry,
  type WorkspaceNote,
} from "@arclattice/application";
import type { LibraryFile } from "@arclattice/domain";
import {
  BookOpen,
  File,
  FileText,
  FolderOpen,
  LayoutGrid,
  NotebookPen,
} from "lucide-react";
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { confirmAction } from "../../components/ui/ConfirmationHost";
import { EntityRow } from "../../components/ui/Content";
import { Dialog, Select } from "../../components/ui/Surfaces";
import { EntityIcon } from "../notes/EntityIcon";
import { fileHash } from "./fileRoute";
import { ResourceUploadQueue } from "./ResourceUploadQueue";
import { useResourceShortcuts } from "./useResourceShortcuts";
import "./files-workspace.css";

import type { VersionedResource } from "./versioned-resource";

type ResourceKind = "ALL" | "NOTE" | "DOCUMENT" | "FILE";

interface ResourceRow {
  key: string;
  kind: Exclude<ResourceKind, "ALL">;
  title: string;
  location: string;
  updatedAt: string;
  version: number;
  parentDocumentId?: string | null | undefined;
  icon: string;
  size?: number;
  mime?: string;
  /** Folder key for notes; the resource browser keeps folders as a note filter. */
  folderKey: string | null;
  projectIds?: ReadonlySet<string> | undefined;
  note?: WorkspaceNote;
  ref?: EntityRef;
}

/**
 * Files is one browser over the workspace's real resources. Note folders stay a
 * note-only organizing axis (Document/File keep their existing parents); the
 * rail is therefore labelled as note folders instead of pretending one model.
 */
export function FilesWorkspace({
  scopeKey,
  active,
  workspaceId,
  notes,
  library,
  fileEntries,
  projectMaterials,
  projects,
  relations,
  folderPanel,
  folderFilter,
  clearFilters,
  query,
  busy,
  getFolderKey,
  getFolderLabel,
  getIcon,
  onIcon,
  onOpenNote,
  onOpenResource,
  onDeleteResource,
  onTrashSelection,
  batchPending,
  onUpload,
}: {
  scopeKey: string;
  active: boolean;
  workspaceId: string;
  notes: readonly WorkspaceNote[];
  library: readonly WorkspaceLibraryEntry[];
  fileEntries: readonly LibraryFile[];
  projectMaterials?: readonly ProjectMaterial[];
  relations: ResourceFolderSource;
  projects?: readonly {
    id: string;
    title: string;
    workspaceId: string;
    deletedAt: string | null;
  }[];
  folderPanel?: ReactNode;
  folderFilter: string | null;
  clearFilters(): void;
  query: string;
  busy: boolean;
  getFolderKey(note: WorkspaceNote): string;
  getFolderLabel(note: WorkspaceNote): string;
  getIcon(note: WorkspaceNote): string;
  onIcon(note: WorkspaceNote, icon: string): void;
  onOpenNote(note: WorkspaceNote): void;
  onOpenResource(ref: EntityRef): void;
  onDeleteResource(ref: EntityRef): Promise<void>;
  onTrashSelection(items: readonly VersionedResource[]): Promise<boolean>;
  batchPending: boolean;
  onUpload(file: globalThis.File): Promise<string | null>;
}) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const titleId = useId();
  const shortcuts = useResourceShortcuts(scopeKey);
  const [collection, setCollection] = useState<
    "all" | "favorites" | "recent" | "duplicates"
  >("all");
  const favoriteKeys = useMemo(
    () => new Set(shortcuts.favorites),
    [shortcuts.favorites],
  );
  const recentOrder = useMemo(
    () => new Map(shortcuts.recent.map((key, index) => [key, index])),
    [shortcuts.recent],
  );
  const [kind, setKind] = useState<ResourceKind>("ALL");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [generalFolder, setGeneralFolder] = useState("");
  const [libraryOnly, setLibraryOnly] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  function setLibraryMode(value: boolean) {
    setLibraryOnly(value);
    const base = location.hash.split("?")[0] || "#files";
    history.replaceState(null, "", value ? `${base}?library=1` : base);
  }
  useEffect(() => {
    const sync = () =>
      setLibraryOnly(
        new URLSearchParams(location.hash.split("?")[1] ?? "").get(
          "library",
        ) === "1",
      );
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (libraryOnly && kind === "NOTE") setKind("ALL");
  }, [kind, libraryOnly]);

  // Selecting a folder is inherently a notes operation; move the type view to
  // notes so the result is not an empty "all" list beside a highlighted folder.
  useEffect(() => {
    if (!libraryOnly && folderFilter !== null) setKind("NOTE");
  }, [folderFilter, libraryOnly]);

  const catalog = useMemo(
    () =>
      selectResourceCatalog(workspaceId, {
        notes,
        library,
        files: fileEntries,
        projects: projects ?? [],
        materials: projectMaterials ?? [],
        relations,
      }),
    [
      workspaceId,
      notes,
      library,
      fileEntries,
      projects,
      projectMaterials,
      relations,
    ],
  );
  const rows = useMemo(() => {
    const result: ResourceRow[] = [
      ...(!libraryOnly
        ? catalog.notes.map((note) => ({
            key: `NOTE:${note.id}`,
            kind: "NOTE" as const,
            title: note.title || (zh ? "未命名笔记" : "Untitled note"),
            location: getFolderLabel(note) || (zh ? "未归档" : "Unfiled"),
            updatedAt: note.updatedAt,
            version: note.version,
            icon: getIcon(note),
            folderKey: getFolderKey(note),
            note,
          }))
        : []),
      ...catalog.documents.map(({ entry, location, projectIds }) => ({
        key: `DOCUMENT:${entry.id}`,
        version: entry.version,
        kind: "DOCUMENT" as const,
        parentDocumentId: entry.parentDocumentId,
        title: entry.title || (zh ? "未命名文档" : "Untitled document"),
        location,
        updatedAt: entry.updatedAt,
        icon: "",
        folderKey: null,
        projectIds,
        ref: { kind: "DOCUMENT" as const, id: entry.id },
      })),
      ...catalog.files.map(({ entry, location, projectIds }) => ({
        key: `FILE:${entry.id}`,
        version: entry.version,
        kind: "FILE" as const,
        parentDocumentId: entry.parentDocumentId,
        title: entry.name,
        location,
        updatedAt: entry.updatedAt,
        icon: "",
        folderKey: null,
        projectIds,
        size: entry.size,
        mime: entry.mime,
        ref: { kind: "FILE" as const, id: entry.id },
      })),
    ];
    for (const row of result) {
      const ids = catalog.folderIndex.memberships.get(row.key);
      if (!ids) continue;
      const projects = new Set(row.projectIds);
      for (const id of ids) {
        for (const project of catalog.folderIndex.folders
          .get(id)!
          .projects.keys())
          projects.add(project);
      }
      row.projectIds = projects;
    }
    return result;
  }, [catalog, libraryOnly, zh, getFolderKey, getFolderLabel, getIcon]);
  const collectionRows = useMemo(() => {
    if (collection === "duplicates")
      return rows.filter(
        (row) =>
          row.ref?.kind === "FILE" && catalog.duplicateFiles.has(row.ref.id),
      );
    if (collection === "favorites")
      return rows.filter((row) => favoriteKeys.has(row.key));
    if (collection === "recent")
      return rows.filter((row) => recentOrder.has(row.key));
    return rows;
  }, [collection, rows, favoriteKeys, recentOrder, catalog.duplicateFiles]);
  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of collectionRows)
      for (const id of row.projectIds ?? [])
        counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [collectionRows]);
  const deferredQuery = useDeferredValue(query);
  const searched = deferredQuery.trim().toLocaleLowerCase(i18n.language);
  const activeFolder = catalog.folderIndex.folders.get(generalFolder);
  const visible = useMemo(
    () =>
      collectionRows
        .filter(
          (row) =>
            (kind === "ALL" || row.kind === kind) &&
            (!activeFolder ||
              catalog.folderIndex.memberships
                .get(row.key)
                ?.has(activeFolder.id)) &&
            (projectFilter === null || row.projectIds?.has(projectFilter)) &&
            (kind !== "NOTE" ||
              folderFilter === null ||
              row.folderKey === folderFilter) &&
            (!searched ||
              `${row.title} ${row.location}`
                .toLocaleLowerCase(i18n.language)
                .includes(searched)),
        )
        .sort((a, b) => {
          if (collection === "recent")
            return recentOrder.get(a.key)! - recentOrder.get(b.key)!;
          const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
          if (sort === "updated")
            return byUpdated || a.title.localeCompare(b.title);
          return a.title.localeCompare(b.title, i18n.language) || byUpdated;
        }),
    [
      collectionRows,
      collection,
      activeFolder,
      catalog.folderIndex,
      recentOrder,
      searched,
      projectFilter,
      folderFilter,
      kind,
      sort,
      i18n.language,
    ],
  );
  const counts = useMemo(
    () => ({
      ALL: collectionRows.length,
      NOTE: collectionRows.filter((row) => row.kind === "NOTE").length,
      DOCUMENT: collectionRows.filter((row) => row.kind === "DOCUMENT").length,
      FILE: collectionRows.filter((row) => row.kind === "FILE").length,
    }),
    [collectionRows],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedTrigger = useRef<HTMLElement | null>(null);
  const collectionSelect = useRef<HTMLSelectElement>(null);
  const focusCollection = useRef(false);
  useEffect(() => {
    if (!selectedKey && focusCollection.current) {
      focusCollection.current = false;
      collectionSelect.current?.focus();
    }
  }, [selectedKey]);
  function closeDetails() {
    setSelectedKey(null);
    selectedTrigger.current?.focus();
  }
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const selectionButton = useRef<HTMLButtonElement>(null);
  const pageSize = 60;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const page = Math.min(pageIndex, pageCount - 1);
  const filterSignature = JSON.stringify([
    searched,
    projectFilter,
    generalFolder,
    folderFilter,
    kind,
    sort,
    libraryOnly,
    collection,
  ]);
  const [previousFilter, setPreviousFilter] = useState(filterSignature);
  if (filterSignature !== previousFilter) {
    setPreviousFilter(filterSignature);
    setSelection(null);
    setPageIndex(0);
    setSelectedKey(null);
  }
  const pageRows = visible.slice(page * pageSize, (page + 1) * pageSize);
  const checked = pageRows
    .filter((row) => selection?.has(row.key))
    .map((row) => row.key);
  function saveSelection(favorite: boolean) {
    shortcuts.setFavorites(checked, favorite);
    setSelection(null);
    selectionButton.current?.focus();
  }
  const layoutKey = "orivane-atlas.files.layout." + scopeKey;
  const [grid, setGrid] = useState(() => {
    try {
      return localStorage.getItem(layoutKey) === "grid";
    } catch {
      return false;
    }
  });
  const [foldersOpen, setFoldersOpen] = useState(false);
  useEffect(() => {
    if (!active) {
      setFoldersOpen(false);
      setSelectedKey(null);
    }
  }, [active]);
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 1100px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 1100px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const selectedRow = pageRows.find((row) => row.key === selectedKey) ?? null;
  const matchingFiles =
    selectedRow?.ref?.kind === "FILE"
      ? catalog.duplicateFiles.get(selectedRow.ref.id)
      : undefined;
  const linkedFolders = Array.from(
    catalog.folderIndex.memberships.get(selectedRow?.key ?? "") ?? [],
    (id) => catalog.folderIndex.folders.get(id)!,
  );
  const formatSize = (bytes: number | undefined) => {
    if (bytes === undefined) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const tabs: { value: ResourceKind; label: string }[] = [
    { value: "ALL", label: zh ? "全部" : "All" },
    ...(!libraryOnly
      ? [{ value: "NOTE" as const, label: zh ? "笔记" : "Notes" }]
      : []),
    { value: "DOCUMENT", label: zh ? "文档" : "Documents" },
    { value: "FILE", label: zh ? "文件" : "Files" },
  ];
  const kindLabel = (value: ResourceRow["kind"]) =>
    value === "NOTE"
      ? zh
        ? "笔记"
        : "Note"
      : value === "DOCUMENT"
        ? zh
          ? "文档"
          : "Document"
        : zh
          ? "文件"
          : "File";
  const open = (row: ResourceRow) => {
    shortcuts.markOpened(row.key);
    setSelectedKey(null);
    if (row.note) onOpenNote(row.note);
    else if (row.ref) onOpenResource(row.ref);
  };
  const detail = selectedRow && (
    <>
      <div className="files-detail-heading">
        <span className="files-resource-icon" aria-hidden="true">
          {selectedRow.kind === "NOTE" ? (
            <BookOpen size={17} />
          ) : selectedRow.kind === "DOCUMENT" ? (
            <FileText size={17} />
          ) : (
            <File size={17} />
          )}
        </span>
        <div>
          <h3>{selectedRow.title}</h3>
          <p>
            {kindLabel(selectedRow.kind)}
            {selectedRow.size !== undefined
              ? ` · ${formatSize(selectedRow.size)}`
              : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          type="button"
          aria-label={zh ? "关闭详情" : "Close details"}
          onClick={closeDetails}
        >
          ×
        </Button>
      </div>
      <dl className="files-detail-facts">
        <div>
          <dt>{zh ? "更新时间" : "Updated"}</dt>
          <dd>
            {new Date(selectedRow.updatedAt).toLocaleDateString(i18n.language, {
              month: "short",
              day: "numeric",
            })}
          </dd>
        </div>
        <div>
          <dt>{zh ? "关联位置" : "Linked location"}</dt>
          <dd>{selectedRow.location || (zh ? "工作区" : "Workspace")}</dd>
        </div>
        {linkedFolders.length > 0 && (
          <div>
            <dt>{zh ? "所属集合" : "Collections"}</dt>
            {linkedFolders.map((folder) => (
              <dd key={folder.id}>
                {folder.path}
                {folder.spaces.size > 0 && (
                  <small>
                    {zh ? "关联空间" : "Linked spaces"} ·{" "}
                    {[...folder.spaces.values()].join(" · ")}
                  </small>
                )}
                {folder.projects.size > 0 && (
                  <small>
                    {zh ? "关联项目" : "Linked projects"} ·{" "}
                    {[...folder.projects.values()].join(" · ")}
                  </small>
                )}
              </dd>
            ))}
          </div>
        )}
        {matchingFiles && (
          <div>
            <dt>{zh ? "相同内容的文件" : "Files with identical content"}</dt>
            <dd>
              {zh
                ? `工作区内共 ${matchingFiles.length} 项`
                : `${matchingFiles.length} in this workspace`}
            </dd>
            {matchingFiles
              .filter((file) => file.id !== selectedRow.ref?.id)
              .slice(0, 5)
              .map((file) => (
                <dd key={file.id}>{file.name}</dd>
              ))}
          </div>
        )}
        {selectedRow.mime && (
          <div>
            <dt>{zh ? "类型" : "Type"}</dt>
            <dd>{selectedRow.mime}</dd>
          </div>
        )}
      </dl>
      <div className="files-detail-actions">
        <Button
          variant="secondary"
          type="button"
          onClick={() => open(selectedRow)}
        >
          {zh ? "打开" : "Open"}
        </Button>
        <Button
          variant="ghost"
          type="button"
          aria-pressed={favoriteKeys.has(selectedRow.key)}
          onClick={() => {
            const wasFavorite = favoriteKeys.has(selectedRow.key);
            if (wasFavorite && collection === "favorites") {
              focusCollection.current = true;
              setSelectedKey(null);
            }
            shortcuts.setFavorites([selectedRow.key], !wasFavorite);
          }}
        >
          {zh ? "收藏" : "Favorite"}
        </Button>
        {selectedRow.ref && selectedRow.kind !== "NOTE" && (
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              const ref = selectedRow.ref;
              if (!ref) return;
              void (async () => {
                if (
                  !(await confirmAction(
                    zh
                      ? `将“${selectedRow.title}”移至回收站？`
                      : `Move “${selectedRow.title}” to Trash?`,
                  ))
                )
                  return;
                await onDeleteResource(ref);
                setSelectedKey(null);
              })();
            }}
          >
            {zh ? "移至回收站" : "Move to Trash"}
          </Button>
        )}
      </div>
    </>
  );
  return (
    <div
      className="note-browser-shell files-workspace"
      data-folder-panel={
        !narrow && !libraryOnly && folderPanel ? "true" : "false"
      }
    >
      {folderPanel && !libraryOnly && !narrow && (
        <aside className="note-folder-panel files-folder-panel">
          <p className="files-rail-label">
            <FolderOpen size={13} aria-hidden="true" />
            {zh ? "笔记文件夹" : "Note folders"}
          </p>
          {folderPanel}
        </aside>
      )}
      {active && foldersOpen && narrow && !libraryOnly && (
        <Dialog
          className="ui-dialog files-folders-dialog"
          aria-label={zh ? "笔记文件夹" : "Note folders"}
          onRequestClose={() => setFoldersOpen(false)}
        >
          <div className="files-drawer-heading">
            <h2>{zh ? "笔记文件夹" : "Note folders"}</h2>
            <Button variant="ghost" onClick={() => setFoldersOpen(false)}>
              {zh ? "完成" : "Done"}
            </Button>
          </div>
          {folderPanel}
        </Dialog>
      )}
      <section
        className="workspace-resources files-resource-browser"
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            selectedRow &&
            !event.defaultPrevented &&
            !(event.target as HTMLElement).closest("dialog,[aria-haspopup]")
          ) {
            event.preventDefault();
            closeDetails();
          }
        }}
        aria-labelledby={titleId}
      >
        <header className="files-resource-header">
          <div className="files-resource-heading">
            <h2 id={titleId}>
              {libraryOnly
                ? zh
                  ? "文件库"
                  : "File library"
                : zh
                  ? "工作区资源"
                  : "Workspace resources"}
              <small>{visible.length}</small>
            </h2>
          </div>
          <div className="files-resource-actions">
            {narrow && folderPanel && !libraryOnly && (
              <Button
                variant="secondary"
                aria-haspopup="dialog"
                onClick={() => setFoldersOpen(true)}
              >
                <FolderOpen size={16} />
                {zh ? "笔记文件夹" : "Note folders"}
              </Button>
            )}
            <div
              className="files-kind-tabs"
              role="group"
              aria-label={zh ? "浏览模式" : "Browse mode"}
            >
              <Button
                type="button"
                variant="ghost"
                aria-pressed={!libraryOnly}
                onClick={() => setLibraryMode(false)}
              >
                {zh ? "全部资源" : "All resources"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={libraryOnly}
                onClick={() => setLibraryMode(true)}
              >
                {zh ? "文件库" : "File library"}
              </Button>
            </div>
            <div
              className="files-kind-tabs"
              role="group"
              aria-label={zh ? "资源类型" : "Resource type"}
            >
              {tabs.map((tab) => (
                <Button
                  key={tab.value}
                  type="button"
                  variant="ghost"
                  aria-pressed={kind === tab.value}
                  onClick={() => setKind(tab.value)}
                >
                  {tab.label}
                  <span>{counts[tab.value]}</span>
                </Button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              aria-pressed={grid}
              aria-label={zh ? "网格视图" : "Grid view"}
              title={zh ? "网格视图" : "Grid view"}
              onClick={() => {
                setGrid(!grid);
                try {
                  localStorage.setItem(layoutKey, grid ? "list" : "grid");
                } catch {}
              }}
            >
              <LayoutGrid size={17} />
            </Button>
            <Select
              ref={collectionSelect}
              aria-label={zh ? "个人资源视图" : "Personal resource view"}
              value={collection}
              onChange={(event) =>
                setCollection(event.target.value as typeof collection)
              }
            >
              <option value="all">{zh ? "所有条目" : "All items"}</option>
              <option value="favorites">{zh ? "收藏" : "Favorites"}</option>
              <option value="duplicates">
                {zh ? "重复文件" : "Duplicate files"}
              </option>
              <option value="recent">
                {zh ? "最近打开" : "Recently opened"}
              </option>
            </Select>
            {collection !== "recent" && (
              <Select
                aria-label={zh ? "资源排序" : "Resource order"}
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as "updated" | "name")
                }
              >
                <option value="updated">
                  {zh ? "最近更新" : "Last updated"}
                </option>
                <option value="name">{zh ? "名称" : "Name"}</option>
              </Select>
            )}
            {active && (
              <ResourceUploadQueue
                zh={zh}
                busy={busy}
                onUpload={onUpload}
                onOpenUploaded={(id) => {
                  shortcuts.markOpened("FILE:" + id);
                  location.hash = fileHash(id);
                }}
              />
            )}
          </div>
        </header>
        {catalog.folderIndex.folders.size > 0 && (
          <label className="files-collection-filter">
            {zh ? "集合文件夹" : "Collection folder"}
            <Select
              value={activeFolder?.id ?? ""}
              onChange={(event) => setGeneralFolder(event.target.value)}
            >
              <option value="">{zh ? "所有集合" : "All collections"}</option>
              {Array.from(catalog.folderIndex.folders.values(), (folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path}
                </option>
              ))}
            </Select>
          </label>
        )}
        {catalog.projects.length > 0 && (
          <div className="files-project-folders">
            <span>{zh ? "项目文件夹" : "Project folders"}</span>
            {catalog.projects.map((project) => {
              const count = projectCounts.get(project.id) ?? 0;
              return (
                <Button
                  key={project.id}
                  type="button"
                  variant="ghost"
                  aria-pressed={projectFilter === project.id}
                  onClick={() =>
                    setProjectFilter((current) =>
                      current === project.id ? null : project.id,
                    )
                  }
                >
                  <FolderOpen size={14} />
                  {project.title}
                  <small>{count}</small>
                </Button>
              );
            })}
            {projectFilter && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setProjectFilter(null)}
              >
                {zh ? "清除筛选" : "Clear filter"}
              </Button>
            )}
          </div>
        )}
        {rows.length > 0 && (
          <div
            className="files-selection-toolbar"
            role="group"
            aria-label={zh ? "批量操作" : "Batch actions"}
          >
            <Button
              ref={selectionButton}
              variant="ghost"
              aria-pressed={selection !== null}
              onClick={() => {
                setSelectedKey(null);
                setSelection(selection === null ? new Set() : null);
              }}
            >
              {selection === null
                ? zh
                  ? "多选"
                  : "Select items"
                : zh
                  ? "取消多选"
                  : "Cancel selection"}
            </Button>
            {selection !== null && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={
                      pageRows.length > 0 && checked.length === pageRows.length
                    }
                    disabled={!pageRows.length}
                    onChange={(e) =>
                      setSelection(
                        new Set(
                          e.target.checked
                            ? pageRows.map((row) => row.key)
                            : [],
                        ),
                      )
                    }
                  />
                  {zh ? "选择本页" : "Select this page"}
                </label>
                <span role="status">
                  {zh
                    ? `已选 ${checked.length} 项`
                    : `${checked.length} selected`}
                </span>
                <Button
                  variant="secondary"
                  disabled={!checked.some((id) => !favoriteKeys.has(id))}
                  onClick={() => saveSelection(true)}
                >
                  {zh ? "添加到收藏" : "Add to favorites"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!checked.some((id) => favoriteKeys.has(id))}
                  onClick={() => saveSelection(false)}
                >
                  {zh ? "移出收藏" : "Remove from favorites"}
                </Button>
                <Button
                  variant="danger"
                  pending={batchPending}
                  disabled={!checked.length}
                  onClick={async () => {
                    const items = pageRows
                      .filter((row) => selection.has(row.key))
                      .map((row) => ({
                        kind: row.kind,
                        id: row.note?.id ?? row.ref!.id,
                        parentDocumentId: row.parentDocumentId,
                        version: row.version,
                      }));
                    if (await onTrashSelection(items)) {
                      setSelection(null);
                      selectionButton.current?.focus();
                    }
                  }}
                >
                  {zh ? "所选项移至回收站" : "Move selected to Trash"}
                </Button>
              </>
            )}
          </div>
        )}
        <div className="files-resource-body">
          {visible.length > 0 ? (
            <div className="files-results">
              <div
                className="files-resource-list"
                data-layout={grid ? "grid" : "list"}
              >
                {pageRows.map((row) => {
                  const content = (
                    <>
                      {row.kind === "NOTE" && selection === null ? (
                        <EntityIcon
                          className="files-resource-icon note-file-icon"
                          icon={row.icon}
                          fallback={<BookOpen size={17} />}
                          label={t("chooseIcon")}
                          defaultLabel={t("defaultIcon")}
                          customLabel={t("customIcon")}
                          applyLabel={t("applyIcon")}
                          onChange={(icon) => {
                            if (row.note) onIcon(row.note, icon);
                          }}
                        />
                      ) : (
                        <span
                          className="files-resource-icon"
                          aria-hidden="true"
                        >
                          {row.kind === "NOTE" ? (
                            <BookOpen size={17} />
                          ) : row.kind === "DOCUMENT" ? (
                            <FileText size={17} />
                          ) : (
                            <File size={17} />
                          )}
                        </span>
                      )}
                      <span className="files-resource-title" title={row.title}>
                        {row.title}
                      </span>
                      <span className="files-resource-kind">
                        {kindLabel(row.kind)}
                      </span>
                      <span
                        className={
                          row.kind === "NOTE"
                            ? "files-resource-location note-folder"
                            : "files-resource-location"
                        }
                        title={row.location}
                      >
                        {row.location || (zh ? "工作区" : "Workspace")}
                      </span>
                      <time dateTime={row.updatedAt}>
                        {new Date(row.updatedAt).toLocaleDateString(
                          i18n.language,
                        )}
                      </time>
                    </>
                  );
                  if (selection !== null)
                    return (
                      <label key={row.key} className="files-select-row">
                        <input
                          type="checkbox"
                          aria-label={row.title}
                          checked={selection.has(row.key)}
                          onChange={(event) => {
                            const next = new Set(selection);
                            if (event.target.checked) next.add(row.key);
                            else next.delete(row.key);
                            setSelection(next);
                          }}
                        />
                        <span className="files-resource-row ui-list-row">
                          {content}
                        </span>
                      </label>
                    );
                  return (
                    <EntityRow
                      key={row.key}
                      className={
                        "files-resource-row" +
                        (row.kind === "NOTE" ? " note-card" : "")
                      }
                      intent="INSPECT"
                      selected={selectedKey === row.key}
                      aria-pressed={selectedKey === row.key}
                      aria-label={row.title + " · " + kindLabel(row.kind)}
                      onSelect={() => {
                        selectedTrigger.current =
                          document.activeElement instanceof HTMLElement
                            ? document.activeElement
                            : null;
                        setSelectedKey(row.key);
                      }}
                      onOpen={() => open(row)}
                    >
                      {content}
                    </EntityRow>
                  );
                })}
              </div>
              {pageCount > 1 && (
                <nav
                  className="files-pagination"
                  aria-label={zh ? "资源分页" : "Resource pages"}
                >
                  <Button
                    variant="ghost"
                    disabled={page === 0}
                    onClick={() => {
                      setSelectedKey(null);
                      if (selection) setSelection(new Set());
                      setPageIndex(page - 1);
                    }}
                  >
                    {zh ? "上一页" : "Previous"}
                  </Button>
                  <span role="status">
                    {page + 1} / {pageCount}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={page + 1 === pageCount}
                    onClick={() => {
                      setSelectedKey(null);
                      if (selection) setSelection(new Set());
                      setPageIndex(page + 1);
                    }}
                  >
                    {zh ? "下一页" : "Next"}
                  </Button>
                </nav>
              )}
            </div>
          ) : (
            <div className="files-resource-empty">
              <NotebookPen size={20} aria-hidden="true" />
              <span>
                {searched
                  ? t("noResults")
                  : collection === "duplicates" && !collectionRows.length
                    ? zh
                      ? "当前工作区没有内容相同的文件。"
                      : "No files in this workspace have identical content."
                    : collection === "favorites" && !collectionRows.length
                      ? zh
                        ? "在资源详情中收藏条目，即可在这里找到。"
                        : "Choose Favorite in resource details to keep an item here."
                      : collection === "recent" && !collectionRows.length
                        ? zh
                          ? "从资源中心打开的条目会出现在这里。"
                          : "Items you open from the resource center appear here."
                        : folderFilter !== null && kind === "NOTE"
                          ? zh
                            ? "这个文件夹还没有笔记。"
                            : "This folder has no notes yet."
                          : zh
                            ? "上传文件或创建笔记即可开始整理。"
                            : "Upload a file or create a note to start your collection."}
              </span>
              {(searched ||
                projectFilter ||
                activeFolder ||
                folderFilter ||
                kind !== "ALL" ||
                collection !== "all") && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setKind("ALL");
                    setCollection("all");
                    setProjectFilter(null);
                    setGeneralFolder("");
                    clearFilters();
                  }}
                >
                  {zh ? "清除筛选" : "Clear filters"}
                </Button>
              )}
            </div>
          )}
          {active &&
            selectedRow &&
            (narrow ? (
              <Dialog
                className="ui-dialog files-detail-panel files-detail-dialog"
                aria-label={zh ? "资源详情" : "Resource details"}
                onRequestClose={closeDetails}
              >
                {detail}
              </Dialog>
            ) : (
              <aside
                className="files-detail-panel"
                aria-label={zh ? "资源详情" : "Resource details"}
              >
                {detail}
              </aside>
            ))}
        </div>
      </section>
    </div>
  );
}
