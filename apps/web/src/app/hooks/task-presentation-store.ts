import type { TaskPresentation } from "../../features/tasks/TasksWorkspace";
import { createViewStore } from "./view-store";

/** Shell retains the preference; only the mounted Tasks route subscribes. */
export function createTaskPresentationStore(
  initial: TaskPresentation,
  storageKey = "orivane-atlas.task-presentation",
) {
  let starting = initial;
  try {
    const stored = globalThis.localStorage?.getItem(storageKey);
    if (stored) {
      const value = JSON.parse(stored) as Partial<TaskPresentation>;
      const views = ["list", "board", "timeline"];
      const groups = ["none", "project", "priority", "status"];
      starting = {
        // Tab is intentionally session-scoped: reload returns to the URL/default
        // scope, while layout choices are device preferences.
        tab: initial.tab,
        view: views.includes(value.view ?? "") ? value.view! : initial.view,
        group: groups.includes(value.group ?? "")
          ? value.group!
          : (initial.group ?? "none"),
      };
    }
  } catch {
    /* Local preference only. */
  }
  const store = createViewStore(starting, (previous, next) => {
    const normalized = (value: TaskPresentation): TaskPresentation => ({
      ...value,
      group: value.group ?? "none",
    });
    return (
      normalized(previous).tab === normalized(next).tab &&
      normalized(previous).view === normalized(next).view &&
      normalized(previous).group === normalized(next).group
    );
  });
  const set = store.set;
  store.set = (next) => {
    set(next);
    try {
      globalThis.localStorage?.setItem(
        storageKey,
        JSON.stringify(store.getSnapshot()),
      );
    } catch {
      /* Device UI preference only. */
    }
  };
  return store;
}
export type TaskPresentationStore = ReturnType<
  typeof createTaskPresentationStore
>;
