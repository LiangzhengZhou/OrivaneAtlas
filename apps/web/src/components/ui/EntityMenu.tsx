import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "./Button";
import { MenuItem } from "./Content";
import { Menu } from "./Surfaces";

export function EntityMenu({
  title,
  pending = false,
  onOpen,
  onDelete,
  onDownload,
}: {
  title: string;
  pending?: boolean;
  onOpen?(): void;
  onDelete?(): void;
  onDownload?(): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const anchor = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false);
  const label = zh ? `更多操作：${title}` : `More actions: ${title}`;
  return (
    <>
      <IconButton
        ref={anchor}
        label={label}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal />
      </IconButton>
      {open && (
        <Menu anchorRef={anchor} label={label} onDismiss={() => setOpen(false)}>
          {onOpen && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
            >
              {zh ? "打开" : "Open"}
            </MenuItem>
          )}
          {onDownload && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onDownload();
              }}
            >
              {zh ? "下载" : "Download"}
            </MenuItem>
          )}
          {onDelete && (onOpen || onDownload) && (
            <hr className="ui-menu-separator" />
          )}
          {onDelete && (
            <MenuItem
              className="ui-menu-item-danger"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              {zh ? "移至回收站" : "Move to Trash"}
            </MenuItem>
          )}
        </Menu>
      )}
    </>
  );
}
