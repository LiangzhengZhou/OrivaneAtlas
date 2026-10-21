import type { Priority } from "@arclattice/domain";

/** Human text remains present; color is supplementary, never the only signal. */
export function PrioritySignal({
  priority,
  label,
}: {
  priority: Priority;
  label: string;
}) {
  return (
    <span
      className={`ui-priority-signal ui-priority-${priority.toLowerCase()}`}
    >
      {(priority === "URGENT" || priority === "HIGH") && (
        <span aria-hidden="true">●</span>
      )}
      {label}
    </span>
  );
}
