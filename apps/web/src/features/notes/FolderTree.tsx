import type { Organization } from "@arclattice/application";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "../../components/ui/Button";
import { confirmAction } from "../../components/ui/ConfirmationHost";
import { MenuItem } from "../../components/ui/Content";
import { Menu, Select } from "../../components/ui/Surfaces";
import { EntityIcon } from "./EntityIcon";
import {
  buildFolderTree,
  type FolderNode,
  type FolderSelection,
  folderKey,
  folderMoveTargets,
  type LegacyFolderGroup,
  unfiledKey,
} from "./folder-model";

function countLabel(value: number): string {
  return String(value);
}

export function FolderTree({
  folders,
  notes,
  counts,
  legacy,
  selected,
  busy,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onRestoreFolder,
  onIconFolder,
  onCreateNote,
  onConvertLegacy,
}: {
  folders: readonly Organization[];
  notes: readonly import("@arclattice/application").WorkspaceNote[];
  counts: Map<string, number>;
  legacy: readonly LegacyFolderGroup[];
  selected: FolderSelection;
  busy: boolean;
  onSelect(value: FolderSelection): void;
  onCreateFolder(parentId: string, name: string): Promise<boolean>;
  onRenameFolder(folder: Organization, name: string): Promise<boolean>;
  onMoveFolder(folder: Organization, parentId: string): Promise<boolean>;
  onDeleteFolder(folder: Organization): Promise<boolean>;
  onRestoreFolder(folder: Organization): Promise<boolean>;
  onIconFolder(folder: Organization, icon: string): Promise<boolean>;
  onCreateNote(folderId: string): void;
  onConvertLegacy(): Promise<void>;
}) {
  const { t } = useTranslation("desk");
  const { t: c } = useTranslation("common");
  const treeId = useId();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState<{ parentId: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [converting, setConverting] = useState(false);
  const createInput = useRef<HTMLInputElement>(null);
  const tree = buildFolderTree(folders);
  const countsFor = (id: string) => counts.get(folderKey(id)) ?? 0;
  const legacyCount = legacy.reduce(
    (total, group) => total + group.noteIds.length,
    0,
  );
  const selectedParent =
    selected && selected.startsWith("folder:") && selected.length > 7
      ? selected.slice(7)
      : "";
  async function perform(action: () => Promise<boolean>): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    try {
      return await action();
    } finally {
      setPending(false);
    }
  }
  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function startRename(folder: Organization) {
    setRenaming(folder.id);
    setRenameDraft(folder.name ?? "");
    setMoving(null);
  }
  async function commitRename(folder: Organization) {
    const name = renameDraft.trim();
    if (!name) return;
    if (await perform(() => onRenameFolder(folder, name))) setRenaming(null);
  }
  function startMove(folder: Organization) {
    setMoving(folder.id);
    setMoveTarget(folder.parentId ?? "");
    setRenaming(null);
  }
  async function commitMove(folder: Organization) {
    if (await perform(() => onMoveFolder(folder, moveTarget))) setMoving(null);
  }
  async function commitDelete(folder: Organization) {
    if (
      !(await confirmAction(
        t("deleteFolderConfirm", { name: folder.name ?? "" }),
      ))
    )
      return;
    await perform(() => onDeleteFolder(folder));
  }
  async function commitCreate() {
    const name = draft.trim();
    if (!name || !creating) return;
    if (await perform(() => onCreateFolder(creating.parentId, name))) {
      setCreating(null);
      setDraft("");
    }
  }
  const row = (node: FolderNode) => {
    const folder = node.folder;
    const name = folder.name ?? "";
    const expanded = !collapsed.has(folder.id);
    const hasChildren = node.children.length > 0;
    const active = selected === folderKey(folder.id);
    return (
      <li
        key={folder.id}
        role="treeitem"
        aria-level={node.depth + 1}
        aria-selected={active}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        <div
          className="folder-tree-row"
          data-active={active || undefined}
          style={{ paddingInlineStart: 6 + node.depth * 14 }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="folder-tree-toggle"
              aria-label={
                (expanded ? t("collapseFolder") : t("expandFolder")) +
                ": " +
                name
              }
              onClick={() => toggle(folder.id)}
            >
              {expanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </button>
          ) : (
            <span className="folder-tree-toggle" aria-hidden="true" />
          )}
          <EntityIcon
            className="folder-tree-icon"
            icon={folder.icon ?? ""}
            fallback={<Folder size={15} aria-hidden="true" />}
            label={t("chooseIcon")}
            defaultLabel={t("defaultIcon")}
            customLabel={t("customIcon")}
            applyLabel={t("applyIcon")}
            onChange={(icon) => void onIconFolder(folder, icon)}
          />
          {renaming === folder.id ? (
            <input
              className="folder-tree-input"
              aria-label={t("folderName")}
              value={renameDraft}
              maxLength={80}
              autoFocus
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commitRename(folder);
                if (event.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <button
              type="button"
              className="folder-tree-name"
              aria-label={name}
              onClick={() => onSelect(folderKey(folder.id))}
              onDoubleClick={() => startRename(folder)}
            >
              {name}
            </button>
          )}
          <span className="folder-tree-count">
            {countLabel(countsFor(folder.id))}
          </span>
          <FolderActions
            name={name}
            disabled={busy || pending}
            onCreateNote={() => onCreateNote(folder.id)}
            onCreateFolder={() => {
              setCreating({ parentId: folder.id });
              setDraft("");
              requestAnimationFrame(() => createInput.current?.focus());
            }}
            onRename={() => startRename(folder)}
            onMove={() => startMove(folder)}
            onDelete={() => void commitDelete(folder)}
          />
        </div>
        {renaming === folder.id && (
          <div
            className="folder-tree-inline"
            style={{ marginInlineStart: 6 + node.depth * 14 }}
          >
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void commitRename(folder)}
            >
              {c("save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRenaming(null)}
            >
              {c("cancel")}
            </Button>
          </div>
        )}
        {moving === folder.id && (
          <div
            className="folder-tree-inline"
            style={{ marginInlineStart: 6 + node.depth * 14 }}
          >
            <Select
              aria-label={t("folderMoveTarget")}
              value={moveTarget}
              onChange={(event) => setMoveTarget(event.target.value)}
            >
              <option value="">{t("folderRoot")}</option>
              {folderMoveTargets(folder, folders).map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void commitMove(folder)}
            >
              {t("moveFolder")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMoving(null)}
            >
              {c("cancel")}
            </Button>
          </div>
        )}
        {creating?.parentId === folder.id && (
          <div
            className="folder-tree-inline"
            style={{ marginInlineStart: 6 + node.depth * 14 }}
          >
            <input
              ref={createInput}
              className="folder-tree-input"
              aria-label={t("folderName")}
              placeholder={t("folderName")}
              value={draft}
              maxLength={80}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commitCreate();
                if (event.key === "Escape") setCreating(null);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void commitCreate()}
            >
              {t("createFolder")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreating(null)}
            >
              {c("cancel")}
            </Button>
          </div>
        )}
        {hasChildren && expanded && (
          <ul role="group">{node.children.map(row)}</ul>
        )}
      </li>
    );
  };
  return (
    <nav className="folder-tree" aria-label={t("folders")} id={treeId}>
      <div className="folder-tree-header">
        <span>{t("folders")}</span>
        <IconButton
          label={t("newFolder")}
          disabled={busy || pending}
          onClick={() => {
            setCreating({ parentId: selectedParent });
            setDraft("");
            requestAnimationFrame(() => createInput.current?.focus());
          }}
        >
          <FolderPlus />
        </IconButton>
      </div>
      <ul role="tree" aria-label={t("folders")}>
        <li role="treeitem" aria-level={1} aria-selected={selected === null}>
          <div
            className="folder-tree-row"
            data-active={selected === null || undefined}
          >
            <span className="folder-tree-toggle" aria-hidden="true" />
            <Folder size={15} className="folder-tree-icon" aria-hidden="true" />
            <button
              type="button"
              className="folder-tree-name"
              aria-label={t("allNotes")}
              onClick={() => onSelect(null)}
            >
              {t("allNotes")}
            </button>
            <span className="folder-tree-count">
              {countLabel(notes.length)}
            </span>
          </div>
        </li>
        <li
          role="treeitem"
          aria-level={1}
          aria-selected={selected === unfiledKey}
        >
          <div
            className="folder-tree-row"
            data-active={selected === unfiledKey || undefined}
          >
            <span className="folder-tree-toggle" aria-hidden="true" />
            <NotebookPen
              size={15}
              className="folder-tree-icon"
              aria-hidden="true"
            />
            <button
              type="button"
              className="folder-tree-name"
              aria-label={t("unfiled")}
              onClick={() => onSelect(unfiledKey)}
            >
              {t("unfiled")}
            </button>
            <span className="folder-tree-count">
              {countLabel(counts.get(unfiledKey) ?? 0)}
            </span>
          </div>
        </li>
        {tree.map(row)}
        {legacy.map((group) => {
          const key = "legacy:" + group.name;
          return (
            <li
              role="treeitem"
              aria-level={1}
              aria-selected={selected === key}
              key={key}
            >
              <div
                className="folder-tree-row folder-tree-legacy"
                data-active={selected === key || undefined}
              >
                <span className="folder-tree-toggle" aria-hidden="true" />
                <Folder
                  size={15}
                  className="folder-tree-icon"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="folder-tree-name"
                  aria-label={group.name}
                  title={t("legacyFolderHint")}
                  onClick={() => onSelect(key)}
                >
                  {group.name}
                </button>
                <span className="folder-tree-count">
                  {countLabel(group.noteIds.length)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {creating?.parentId === "" && (
        <div className="folder-tree-inline folder-tree-create">
          <input
            ref={createInput}
            className="folder-tree-input"
            aria-label={t("folderName")}
            placeholder={t("folderName")}
            value={draft}
            maxLength={80}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitCreate();
              if (event.key === "Escape") setCreating(null);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void commitCreate()}
          >
            {t("createFolder")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setCreating(null)}
          >
            {c("cancel")}
          </Button>
        </div>
      )}
      {legacyCount > 0 && (
        <div className="folder-tree-legacy-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={busy || converting}
            onClick={() => {
              setConverting(true);
              void onConvertLegacy().finally(() => setConverting(false));
            }}
          >
            <Undo2 size={15} />
            {t("convertLegacyFolders")}
          </Button>
        </div>
      )}
      {folders.some((folder) => folder.archived) && (
        <details className="folder-tree-deleted">
          <summary>{t("deletedFolders")}</summary>
          {folders
            .filter((folder) => folder.archived)
            .map((folder) => (
              <div key={folder.id} className="folder-tree-row">
                <Folder size={16} aria-hidden="true" />
                <span className="folder-tree-name">{folder.name}</span>
                <Button
                  variant="ghost"
                  disabled={busy || pending}
                  onClick={() => void perform(() => onRestoreFolder(folder))}
                >
                  <Undo2 size={15} />
                  {t("restoreFolder")}
                </Button>
              </div>
            ))}
        </details>
      )}
      <p className="folder-tree-hint">{t("foldersHint")}</p>
    </nav>
  );
}

function FolderActions({
  name,
  disabled,
  onCreateNote,
  onCreateFolder,
  onRename,
  onMove,
  onDelete,
}: {
  name: string;
  disabled: boolean;
  onCreateNote(): void;
  onCreateFolder(): void;
  onRename(): void;
  onMove(): void;
  onDelete(): void;
}) {
  const { t } = useTranslation("desk");
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = t("folderActions") + ": " + name;
  return (
    <>
      <IconButton
        ref={anchor}
        label={label}
        className="folder-tree-actions"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={15} />
      </IconButton>
      {open && (
        <Menu anchorRef={anchor} label={label} onDismiss={() => setOpen(false)}>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onCreateNote();
            }}
          >
            <NotebookPen size={15} /> {t("newDocumentInFolder")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onCreateFolder();
            }}
          >
            <FolderPlus size={15} /> {t("newFolder")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            <Pencil size={15} /> {t("renameFolder")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onMove();
            }}
          >
            <ChevronRight size={15} /> {t("moveFolder")}
          </MenuItem>
          <hr className="ui-menu-separator" />
          <MenuItem
            className="ui-menu-item-danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={15} /> {t("deleteFolder")}
          </MenuItem>
        </Menu>
      )}
    </>
  );
}
