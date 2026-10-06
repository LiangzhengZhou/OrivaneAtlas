import type { WorkItem } from "@arclattice/domain";
import { useEntitySelection } from "../../app/EntitySelection";
import { ListRow } from "../../components/ui/Content";

export function CalendarEventRow({
  item,
  signal,
  onOpen,
}: {
  item: WorkItem;
  signal: string;
  onOpen(item: WorkItem): void;
}) {
  const selection = useEntitySelection();
  return (
    <ListRow
      className="calendar-event-row"
      selected={
        selection?.selected?.kind === "WORK" &&
        selection.selected.id === item.id
      }
      onSelect={() => selection?.select({ kind: "WORK", id: item.id })}
      onOpen={() => onOpen(item)}
    >
      <span aria-hidden="true">{signal}</span>
      <span>{item.title}</span>
    </ListRow>
  );
}
