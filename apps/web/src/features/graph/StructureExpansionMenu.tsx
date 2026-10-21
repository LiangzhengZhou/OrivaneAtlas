import { useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { MenuItem } from "../../components/ui/Content";
import { Menu } from "../../components/ui/Surfaces";

/** Bulk expansion is secondary to following the visible project hierarchy. */
export function StructureExpansionMenu({
  zh,
  hasSecondLevel,
  onExpand,
  onCollapse,
}: {
  zh: boolean;
  hasSecondLevel: boolean;
  onExpand(): void;
  onCollapse(): void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = zh ? "展开选项" : "Expansion options";
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {open && (
        <Menu anchorRef={anchor} label={label} onDismiss={() => setOpen(false)}>
          <MenuItem
            disabled={!hasSecondLevel}
            title={
              !hasSecondLevel
                ? zh
                  ? "没有第二层子项目"
                  : "No second-level subprojects"
                : undefined
            }
            onClick={() => {
              setOpen(false);
              onExpand();
            }}
          >
            {zh ? "展开两层" : "Expand two levels"}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onCollapse();
            }}
          >
            {zh ? "全部折叠" : "Collapse all"}
          </MenuItem>
        </Menu>
      )}
    </>
  );
}
