import { SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { MenuItem } from "../../components/ui/Content";
import { Menu } from "../../components/ui/Surfaces";

export function ConversationFilters({
  zh,
  archived,
  grouped,
  onArchived,
  onGrouped,
}: {
  zh: boolean;
  archived: boolean;
  grouped: boolean;
  onArchived(value: boolean): void;
  onGrouped(value: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const label = zh ? "对话筛选" : "Conversation filters";
  return (
    <div className="conversation-list-filters">
      <Button
        variant="ghost"
        aria-pressed={!archived}
        onClick={() => onArchived(false)}
      >
        {zh ? "最近" : "Recent"}
      </Button>
      <IconButton
        ref={anchor}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal />
      </IconButton>
      {archived && <small>{zh ? "归档" : "Archived"}</small>}
      {open && (
        <Menu label={label} anchorRef={anchor} onDismiss={() => setOpen(false)}>
          <MenuItem
            role="menuitemradio"
            aria-checked={archived}
            onClick={() => {
              onArchived(!archived);
              setOpen(false);
            }}
          >
            {zh ? "归档" : "Archived"}
          </MenuItem>
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={grouped}
            onClick={() => {
              onGrouped(!grouped);
              setOpen(false);
            }}
          >
            {zh ? "项目" : "Projects"}
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}
