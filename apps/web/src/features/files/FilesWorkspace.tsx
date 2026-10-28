import type {
  EntityRef,
  WorkspaceLibraryEntry,
  WorkspaceNote,
} from "@arclattice/application";
import type { LibraryFile } from "@arclattice/domain";
import {
  BookOpen,
  File,
  FileText,
  FolderOpen,
  NotebookPen,
  Upload,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { EntityRow } from "../../components/ui/Content";
import { Select } from "../../components/ui/Surfaces";
import { EntityIcon } from "../notes/EntityIcon";
import "./files-workspace.css";

type ResourceKind = "ALL" | "NOTE" | "DOCUMENT" | "FILE";

interface ResourceRow {
  key: string;
  kind: Exclude<ResourceKind, "ALL">;
  title: string;
  location: string;
  updatedAt: string;
  icon: string;
  /** Folder key for notes; the resource browser keeps folders as a note filter. */
  folderKey: string | null;
  note?: WorkspaceNote;
  ref?: EntityRef;
}

/**
 * Files is one browser over the workspace's real resources. Note folders stay a
 * note-only organizing axis (Document/File keep their existing parents); the
 * rail is therefore labelled as note folders instead of pretending one model.
 */
export function FilesWorkspace({
  notes,
  library,
  fileEntries,
  folderPanel,
  folderFilter,
  query,
  busy,
  getFolderKey,
  getFolderLabel,
  getIcon,
  onIcon,
  onOpenNote,
  onOpenResource,
  onUpload,
}: {
  notes: readonly WorkspaceNote[];
  library: readonly WorkspaceLibraryEntry[];
  fileEntries: readonly LibraryFile[];
  folderPanel?: ReactNode;
  folderFilter: string | null;
  query: string;
  busy: boolean;
  getFolderKey(note: WorkspaceNote): string;
  getFolderLabel(note: WorkspaceNote): string;
  getIcon(note: WorkspaceNote): string;
  onIcon(note: WorkspaceNote, icon: string): void;
  onOpenNote(note: WorkspaceNote): void;
  onOpenResource(ref: EntityRef): void;
  onUpload(file: globalThis.File): Promise<boolean>;
}) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ResourceKind>("ALL");
  const [sort, setSort] = useState<"updated" | "name">("updated");

  // Selecting a folder is inherently a notes operation; move the type view to
  // notes so the result is not an empty "all" list beside a highlighted folder.
  useEffect(() => {
    if (folderFilter !== null) setKind("NOTE");
  }, [folderFilter]);

  const spaces = new Map(library.map((entry) => [entry.id, entry]));
  const rows: ResourceRow[] = [
    ...notes
      .filter((note) => !note.deletedAt && note.kind === "NOTE")
      .map((note) => ({
        key: `NOTE:${note.id}`,
        kind: "NOTE" as const,
        title: note.title || (zh ? "未命名笔记" : "Untitled note"),
        location: getFolderLabel(note) || (zh ? "未归档" : "Unfiled"),
        updatedAt: note.updatedAt,
        icon: getIcon(note),
        folderKey: getFolderKey(note),
        note,
      })),
    ...library
      .filter((entry) => entry.kind === "DOCUMENT" && !entry.deletedAt)
      .map((entry) => ({
        key: `DOCUMENT:${entry.id}`,
        kind: "DOCUMENT" as const,
        title: entry.title || (zh ? "未命名文档" : "Untitled document"),
        location: spaces.get(entry.spaceId ?? "")?.title ?? "",
        updatedAt: entry.updatedAt,
        icon: "",
        folderKey: null,
        ref: { kind: "DOCUMENT" as const, id: entry.id },
      })),
    ...fileEntries
      .filter((entry) => !entry.deletedAt)
      .map((entry) => ({
        key: `FILE:${entry.id}`,
        kind: "FILE" as const,
        title: entry.name,
        location:
          spaces.get(entry.parentDocumentId ?? entry.spaceId ?? "")?.title ??
          "",
        updatedAt: entry.updatedAt,
        icon: "",
        folderKey: null,
        ref: { kind: "FILE" as const, id: entry.id },
      })),
  ];
  const searched = query.trim().toLocaleLowerCase(i18n.language);
  const visible = rows
    .filter(
      (row) =>
        (kind === "ALL" || row.kind === kind) &&
        (kind !== "NOTE" ||
          folderFilter === null ||
          row.folderKey === folderFilter) &&
        (!searched ||
          `${row.title} ${row.location}`
            .toLocaleLowerCase(i18n.language)
            .includes(searched)),
    )
    .sort((a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      if (sort === "updated")
        return byUpdated || a.title.localeCompare(b.title);
      return a.title.localeCompare(b.title, i18n.language) || byUpdated;
    });
  const counts = {
    ALL: rows.length,
    NOTE: rows.filter((row) => row.kind === "NOTE").length,
    DOCUMENT: rows.filter((row) => row.kind === "DOCUMENT").length,
    FILE: rows.filter((row) => row.kind === "FILE").length,
  };
  const tabs: { value: ResourceKind; label: string }[] = [
    { value: "ALL", label: zh ? "全部" : "All" },
    { value: "NOTE", label: zh ? "笔记" : "Notes" },
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
    if (row.note) onOpenNote(row.note);
    else if (row.ref) onOpenResource(row.ref);
  };
  return (
    <div className="note-browser-shell files-workspace">
      {folderPanel && (
        <aside className="note-folder-panel files-folder-panel">
          <p className="files-rail-label">
            <FolderOpen size={13} aria-hidden="true" />
            {zh ? "笔记文件夹" : "Note folders"}
          </p>
          {folderPanel}
        </aside>
      )}
      <section
        className="workspace-resources files-resource-browser"
        aria-labelledby={titleId}
      >
        <header className="files-resource-header">
          <div className="files-resource-heading">
            <h2 id={titleId}>
              {zh ? "工作区资源" : "Workspace resources"}
              <small>{visible.length}</small>
            </h2>
            <p>
              {zh
                ? "笔记、文档与文件在同一处浏览；笔记文件夹只组织笔记。"
                : "Notes, documents and files in one place; note folders only organize notes."}
            </p>
          </div>
          <div className="files-resource-actions">
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
            <Button
              variant="secondary"
              aria-label={zh ? "上传文件" : "Upload file"}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload size={15} />
              <span className="files-upload-label">
                {zh ? "上传文件" : "Upload"}
              </span>
            </Button>
            <input
              hidden
              type="file"
              ref={input}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onUpload(file);
              }}
            />
          </div>
        </header>
        {visible.length > 0 ? (
          <div className="files-resource-list">
            {visible.map((row) => {
              const content = (
                <>
                  {row.kind === "NOTE" ? (
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
                    <span className="files-resource-icon" aria-hidden="true">
                      {row.kind === "DOCUMENT" ? (
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
                    {new Date(row.updatedAt).toLocaleDateString(i18n.language)}
                  </time>
                </>
              );
              if (row.kind === "NOTE" && row.note)
                return (
                  <EntityRow
                    key={row.key}
                    className="files-resource-row note-card"
                    intent="NAVIGATE"
                    aria-label={`${row.title} · ${kindLabel(row.kind)}`}
                    onOpen={() => open(row)}
                  >
                    {content}
                  </EntityRow>
                );
              return (
                <Button
                  key={row.key}
                  type="button"
                  variant="ghost"
                  className="files-resource-row"
                  aria-label={`${row.title} · ${kindLabel(row.kind)}`}
                  onClick={() => open(row)}
                >
                  {content}
                </Button>
              );
            })}
          </div>
        ) : (
          <div className="files-resource-empty">
            <NotebookPen size={20} aria-hidden="true" />
            <span>
              {searched
                ? t("noResults")
                : folderFilter !== null && kind === "NOTE"
                  ? zh
                    ? "这个文件夹还没有笔记。"
                    : "This folder has no notes yet."
                  : zh
                    ? "这里还没有匹配的资源。"
                    : "No matching resources yet."}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
