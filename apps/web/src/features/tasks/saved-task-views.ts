import type { TaskPresentation } from "./TasksWorkspace";

export interface SavedTaskView {
  readonly id: string;
  readonly name: string;
  readonly presentation: TaskPresentation;
}

const STORAGE_KEY = "orivane-atlas.task-saved-views";
const MAX_SAVED_VIEWS = 12;

function validPresentation(value: unknown): value is TaskPresentation {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<TaskPresentation>;
  return (
    ["now", "later", "scheduled", "completed", "all"].includes(
      entry.tab ?? "",
    ) &&
    ["list", "board", "timeline"].includes(entry.view ?? "") &&
    (entry.group === undefined ||
      ["none", "project", "priority", "status"].includes(entry.group))
  );
}

export function loadSavedTaskViews(): SavedTaskView[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is SavedTaskView =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as SavedTaskView).id === "string" &&
          typeof (entry as SavedTaskView).name === "string" &&
          !!(entry as SavedTaskView).name.trim() &&
          validPresentation((entry as SavedTaskView).presentation),
      )
      .slice(0, MAX_SAVED_VIEWS);
  } catch {
    return [];
  }
}

export function saveSavedTaskViews(views: readonly SavedTaskView[]): void {
  try {
    globalThis.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify(views.slice(0, MAX_SAVED_VIEWS)),
    );
  } catch {
    /* Device UI preference only. */
  }
}

export function savedTaskViewId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `view-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
