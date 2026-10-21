import type { EntityRef } from "@arclattice/application";
import type { LibraryFile } from "@arclattice/domain";
import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "../../components/ui/Button";
import { MenuItem } from "../../components/ui/Content";
import { Menu } from "../../components/ui/Surfaces";

export function ProjectFileRow({
  file,
  busy,
  onOpen,
  onDownload,
  onDelete,
}: {
  file: LibraryFile;
  busy: boolean;
  onOpen(ref: EntityRef): void;
  onDownload(file: LibraryFile): Promise<void>;
  onDelete(file: LibraryFile, deleted: boolean): Promise<boolean>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = `${zh ? "文件操作：" : "File actions: "}${file.name}`;
  return (
    <div className="project-material project-file" data-file-id={file.id}>
      <Button
        variant="ghost"
        disabled={!!file.deletedAt}
        onClick={() => onOpen({ kind: "FILE", id: file.id })}
      >
        {file.name}
      </Button>
      <small>{file.size} B</small>
      <IconButton
        ref={anchor}
        label={label}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={17} />
      </IconButton>
      {open && (
        <Menu anchorRef={anchor} label={label} onDismiss={() => setOpen(false)}>
          {!file.deletedAt && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                void onDownload(file);
              }}
            >
              {zh ? "下载" : "Download"}
            </MenuItem>
          )}
          {!file.deletedAt && <hr className="ui-menu-separator" />}
          <MenuItem
            className={!file.deletedAt ? "ui-menu-item-danger" : ""}
            onClick={() => {
              setOpen(false);
              void onDelete(file, !file.deletedAt);
            }}
          >
            {file.deletedAt
              ? zh
                ? "恢复"
                : "Restore"
              : zh
                ? "移至回收站"
                : "Move to Trash"}
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}
