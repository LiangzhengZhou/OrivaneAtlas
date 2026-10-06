import type { TaskPresentation } from "../../features/tasks/TasksWorkspace";
import { createViewStore } from "./view-store";

/** Shell retains the preference; only the mounted Tasks route subscribes. */
export function createTaskPresentationStore(initial: TaskPresentation) {
  return createViewStore(
    initial,
    (previous, next) =>
      previous.tab === next.tab && previous.view === next.view,
  );
}
export type TaskPresentationStore = ReturnType<
  typeof createTaskPresentationStore
>;
