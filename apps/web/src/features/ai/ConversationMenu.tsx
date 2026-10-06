import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { MenuItem } from "../../components/ui/Content";
import { Menu } from "../../components/ui/Surfaces";

export function ConversationMenu({
  zh,
  archived,
  disabled,
  onRename,
  onArchive,
  onDelete,
}: {
  zh: boolean;
  archived: boolean;
  disabled: boolean;
  onRename(): void;
  onArchive(): void;
  onDelete(): void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const label = zh ? "对话选项" : "Conversation options";
  return (
    <div className="conversation-options">
      <IconButton
        ref={anchor}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal />
      </IconButton>
      {open && (
        <Menu anchorRef={anchor} label={label} onDismiss={() => setOpen(false)}>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            {zh ? "重命名" : "Rename"}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onArchive();
            }}
          >
            {archived ? (zh ? "恢复" : "Restore") : zh ? "归档" : "Archive"}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            {zh ? "删除对话" : "Delete conversation"}
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}
