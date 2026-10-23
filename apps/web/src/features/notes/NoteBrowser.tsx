import type { WorkspaceNote } from "@arclattice/application";
import { BookOpen, ChevronDown, LockKeyhole, NotebookPen } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { EntityRow } from "../../components/ui/Content";
import { EntityMenu } from "../../components/ui/EntityMenu";
import { Select } from "../../components/ui/Surfaces";
import {
  groupJournalEntries,
  journalGroupings,
  journalGroupLabel,
  type NotePresentation,
  noteLayouts,
} from "./note-presentation";

export function NoteBrowser({
  entries,
  journal,
  presentation,
  onPresentation,
  folderFilter,
  onFolderFilter,
  folders,
  getFolder,
  selectedIds,
  onSelection,
  pending,
  selectionActions,
  date,
  onOpen,
  onInspect,
  onDelete,
  searching,
}: {
  entries: WorkspaceNote[];
  journal: boolean;
  presentation: NotePresentation;
  onPresentation(value: NotePresentation): void;
  folderFilter: string | null;
  onFolderFilter(value: string | null): void;
  folders: string[];
  getFolder(id: string): string;
  selectedIds: string[];
  onSelection(ids: string[]): void;
  pending: boolean;
  selectionActions: ReactNode;
  date(instant: string): string;
  onOpen(note: WorkspaceNote): void;
  onInspect(note: WorkspaceNote): void;
  onDelete(note: WorkspaceNote): void;
  searching: boolean;
}) {
  const { t, i18n } = useTranslation("desk");
  const groupId = useId();
  const { layout, grouping, sort, collapsed } = presentation;
  const sorted = entries
    .filter(
      (note) => folderFilter === null || getFolder(note.id) === folderFilter,
    )
    .sort(
      (a, b) =>
        (sort === "title"
          ? a.title.localeCompare(b.title, i18n.language)
          : sort === "day"
            ? (b.day ?? "").localeCompare(a.day ?? "")
            : b.updatedAt.localeCompare(a.updatedAt)) ||
        a.id.localeCompare(b.id),
    );
  const groups = groupJournalEntries(sorted, journal ? grouping : "none");
  const grouped = journal && grouping !== "none";
  // Search matches remain discoverable even when their original group is folded.
  const isCollapsed = (key: string) => !searching && collapsed.includes(key);
  const visible = groups.flatMap(([key, notes]) =>
    isCollapsed(key) ? [] : notes,
  );
  const selected = new Set(selectedIds);
  const changeFold = (keys: string[]) => {
    onPresentation({ ...presentation, collapsed: keys });
    const hidden = new Set(
      groups
        .filter(([key]) => keys.includes(key))
        .flatMap(([, notes]) => notes.map((note) => note.id)),
    );
    onSelection(selectedIds.filter((id) => !hidden.has(id)));
  };
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("note-card")) return;
    const cards = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(".note-card"),
    ];
    const index = cards.indexOf(target);
    const grid = target.closest(".note-grid")!;
    const columns =
      getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? cards.length - 1
          : event.key === "ArrowDown"
            ? index + columns
            : event.key === "ArrowUp"
              ? index - columns
              : event.key === "ArrowRight"
                ? index + 1
                : event.key === "ArrowLeft"
                  ? index - 1
                  : null;
    if (next === null) return;
    event.preventDefault();
    cards[Math.max(0, Math.min(cards.length - 1, next))]?.focus();
  }
  const renderRows = (notes: WorkspaceNote[]) => (
    <div className="note-grid">
      {notes.map((note) => (
        <article
          className="selectable-note"
          key={note.id}
          data-checked={selected.has(note.id) || undefined}
        >
          <label className="note-selection">
            <input
              type="checkbox"
              aria-label={t("selectNote", { title: note.title })}
              checked={selected.has(note.id)}
              disabled={
                pending || (!selected.has(note.id) && selectedIds.length >= 100)
              }
              onChange={(event) =>
                onSelection(
                  event.target.checked
                    ? [...selectedIds, note.id]
                    : selectedIds.filter((id) => id !== note.id),
                )
              }
            />
          </label>
          <EntityRow
            className="note-card"
            intent="NAVIGATE"
            onOpen={() => onOpen(note)}
            aria-label={note.title}
          >
            {note.kind === "JOURNAL" ? (
              <NotebookPen className="note-file-icon" aria-hidden="true" />
            ) : (
              <BookOpen className="note-file-icon" aria-hidden="true" />
            )}
            <h3 title={note.title}>{note.title}</h3>
            <span
              className="note-folder"
              title={getFolder(note.id) || t("unfiled")}
            >
              {getFolder(note.id) || t("unfiled")}
            </span>
            <time
              className="note-date"
              dateTime={note.day ?? note.updatedAt}
              title={note.day ?? note.updatedAt}
            >
              {note.day ?? date(note.updatedAt)}
            </time>
            <span className="note-private" title={t("private")}>
              <LockKeyhole size={13} aria-label={t("private")} />
            </span>
            <div className="note-actions">
              <EntityMenu
                title={note.title}
                pending={pending}
                onOpen={() => onOpen(note)}
                onInspect={() => onInspect(note)}
                onDelete={() => onDelete(note)}
              />
            </div>
          </EntityRow>
        </article>
      ))}
    </div>
  );
  return (
    <div className="note-browser" data-layout={layout} onKeyDown={moveFocus}>
      <div className="organization-toolbar note-view-toolbar">
        <label>
          {t("noteBrowser.view")}
          <Select
            aria-label={t("noteBrowser.view")}
            value={layout}
            onChange={(event) =>
              onPresentation({
                ...presentation,
                layout: event.target.value as NotePresentation["layout"],
              })
            }
          >
            {noteLayouts.map((value) => (
              <option key={value} value={value}>
                {t(`noteBrowser.layout.${value}`)}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t("sort")}
          <Select
            aria-label={t("noteBrowser.sort")}
            value={sort}
            onChange={(event) =>
              onPresentation({
                ...presentation,
                sort: event.target.value as NotePresentation["sort"],
              })
            }
          >
            {journal && (
              <option value="day">{t("noteBrowser.journalDate")}</option>
            )}
            <option value="updated">{t("noteBrowser.updated")}</option>
            <option value="title">{t("title")}</option>
          </Select>
        </label>
        <label>
          {t("folder")}
          <Select
            aria-label={t("folderFilter")}
            value={folderFilter === null ? "all" : `folder:${folderFilter}`}
            onChange={(event) => {
              onFolderFilter(
                event.target.value === "all"
                  ? null
                  : event.target.value.slice(7),
              );
              onSelection([]);
            }}
          >
            <option value="all">{t("allFolders")}</option>
            <option value="folder:">{t("unfiled")}</option>
            {folders.map((folder) => (
              <option key={folder} value={`folder:${folder}`}>
                {folder}
              </option>
            ))}
          </Select>
        </label>
        {journal && (
          <label>
            {t("noteBrowser.groupBy")}
            <Select
              aria-label={t("noteBrowser.groupBy")}
              value={grouping}
              onChange={(event) => {
                onPresentation({
                  ...presentation,
                  grouping: event.target.value as NotePresentation["grouping"],
                  collapsed: [],
                });
                onSelection([]);
              }}
            >
              {journalGroupings.map((value) => (
                <option key={value} value={value}>
                  {t(`noteBrowser.grouping.${value}`)}
                </option>
              ))}
            </Select>
          </label>
        )}
        {grouped && (
          <div className="note-fold-actions">
            <Button
              variant="ghost"
              disabled={searching || groups.every(([key]) => !isCollapsed(key))}
              onClick={() => changeFold([])}
            >
              {t("noteBrowser.expandAll")}
            </Button>
            <Button
              variant="ghost"
              disabled={searching || groups.every(([key]) => isCollapsed(key))}
              onClick={() => changeFold(groups.map(([key]) => key))}
            >
              {t("noteBrowser.collapseAll")}
            </Button>
          </div>
        )}
      </div>
      <div className="organization-toolbar note-selection-toolbar">
        <label>
          <input
            type="checkbox"
            aria-label={t("selectVisible")}
            checked={
              visible.length > 0 &&
              visible.every((note) => selected.has(note.id))
            }
            disabled={pending || visible.length === 0 || visible.length > 100}
            onChange={(event) =>
              onSelection(
                event.target.checked ? visible.map((note) => note.id) : [],
              )
            }
          />
          {t("selectVisible")}
        </label>
        {selectedIds.length > 0 && (
          <>
            <span role="status">
              {t("selectionCount", { count: selectedIds.length })}
            </span>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => onSelection([])}
            >
              {t("clearSelection")}
            </Button>
            {selectionActions}
          </>
        )}
      </div>
      {layout === "list" && sorted.length > 0 && (
        <div className="note-list-header" aria-hidden="true">
          <span />{" "}
          <div className="note-list-columns">
            <span />
            <span>{t("title")}</span>
            <span className="note-folder">{t("folder")}</span>
            <span className="note-date">
              {t(journal ? "noteBrowser.journalDate" : "noteBrowser.updated")}
            </span>
            <span />
            <span />
          </div>
        </div>
      )}
      {groups.map(([key, notes]) =>
        grouped ? (
          <section className="journal-group" key={key}>
            <button
              type="button"
              className="journal-group-toggle"
              aria-expanded={!isCollapsed(key)}
              aria-controls={`${groupId}-${key}`}
              onClick={() => {
                if (!searching)
                  changeFold(
                    isCollapsed(key)
                      ? collapsed.filter((value) => value !== key)
                      : [...collapsed, key],
                  );
              }}
              aria-disabled={searching || undefined}
            >
              <ChevronDown size={16} aria-hidden="true" />
              <span>
                {key === "undated"
                  ? t("noteBrowser.undated")
                  : journalGroupLabel(key, grouping, i18n.language)}
              </span>
              <span className="journal-group-count">
                {t("noteBrowser.count", { count: notes.length })}
              </span>
            </button>
            <div id={`${groupId}-${key}`}>
              {!isCollapsed(key) && renderRows(notes)}
            </div>
          </section>
        ) : (
          <div key={key}>{renderRows(notes)}</div>
        ),
      )}
      {sorted.length === 0 && (
        <p className="note-browser-empty">{t("noResults")}</p>
      )}
    </div>
  );
}
