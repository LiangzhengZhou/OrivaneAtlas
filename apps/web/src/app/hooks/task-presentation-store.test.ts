import { expect, test } from "vitest";
import { createTaskPresentationStore } from "./task-presentation-store";

test("presentation survives subscriber unmount and notifies only meaningful changes", () => {
  const store = createTaskPresentationStore({ tab: "now", view: "list" });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  store.set({ tab: "now", view: "list" });
  expect(notifications).toBe(0);
  store.set((previous) => ({ ...previous, tab: "scheduled" }));
  expect(notifications).toBe(1);
  unsubscribe();
  store.set((previous) => ({ ...previous, view: "board" }));
  expect(notifications).toBe(1);
  expect(store.getSnapshot()).toEqual({ tab: "scheduled", view: "board" });
  const second = createTaskPresentationStore({ tab: "now", view: "list" });
  expect(second.getSnapshot()).toEqual({ tab: "now", view: "list" });
});
