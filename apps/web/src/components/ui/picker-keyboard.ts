import type { KeyboardEvent } from "react";

/** Navigation moves focus only; Enter/Space retain the button's explicit action. */
export function pickerKeyboard(
  event: KeyboardEvent<HTMLElement>,
  onBack?: () => void,
) {
  if (event.key === "ArrowLeft" && onBack) {
    event.preventDefault();
    onBack();
    return;
  }
  const target = event.target as HTMLElement;
  if (event.key === "ArrowRight") {
    const row = target.closest(".ui-entity-picker-row");
    const explore = row?.querySelector<HTMLButtonElement>(
      ".ui-icon-button:not(:disabled)",
    );
    if (explore) {
      event.preventDefault();
      explore.click();
    }
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  if (target.matches("input") && !["ArrowDown", "ArrowUp"].includes(event.key))
    return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      ".ui-entity-picker-choice:not(:disabled), [data-picker-navigation]:not(:disabled)",
    ),
  );
  if (!rows.length) return;
  const index = rows.indexOf(target as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : index < 0
          ? event.key === "ArrowDown"
            ? 0
            : rows.length - 1
          : index + (event.key === "ArrowDown" ? 1 : -1);
  event.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
}
