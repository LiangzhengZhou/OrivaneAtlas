import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button, IconButton } from "./Button";

/** The row selects; its independent chevron explores. Selection is never a second action. */
export function EntityPickerRow({
  title,
  path,
  description,
  as = "li",
  selected,
  disabled = false,
  exploreDisabled = disabled,
  exploreLabel,
  onSelect,
  onExplore,
}: {
  title: string;
  path?: string;
  description?: ReactNode;
  as?: "li" | "div";
  selected: boolean;
  disabled?: boolean;
  exploreDisabled?: boolean;
  exploreLabel: string;
  onSelect(): void;
  onExplore?: (() => void) | undefined;
}) {
  const Row = as;
  const choice = (
    <Button
      variant="ghost"
      className={`ui-entity-picker-choice${as === "div" && !onExplore ? " ui-entity-picker-row" : ""}`}
      aria-label={title}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      title={path}
    >
      {title}
      {description && <small>{description}</small>}
    </Button>
  );
  // A task leaf is already a semantic pressable row; only list semantics or
  // an independent explore action require an additional row container.
  if (as === "div" && !onExplore) return choice;
  return (
    <Row className="ui-entity-picker-row">
      {choice}
      {onExplore && (
        <IconButton
          label={exploreLabel}
          disabled={exploreDisabled}
          onClick={onExplore}
        >
          <ChevronRight size={16} />
        </IconButton>
      )}
    </Row>
  );
}
