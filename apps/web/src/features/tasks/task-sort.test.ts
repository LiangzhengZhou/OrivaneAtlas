import type { WorkItem } from "@arclattice/domain";
import { describe, expect, it } from "vitest";
import { work } from "../../../../../tests/fixtures";
import { taskPresentationComparator } from "./task-sort";

const task = (id: string, timerStartedAt?: string): WorkItem =>
  ({ ...(work(id) as WorkItem), timerStartedAt }) as WorkItem;

describe("task presentation ordering", () => {
  it("keeps running timers ahead of every configured sort", () => {
    const running = task("running", "2026-01-01T00:00:00.000Z");
    const earlierDue = { ...task("early"), dueDate: "2020-01-01" } as WorkItem;
    const laterDue = { ...task("late"), dueDate: "2099-01-01" } as WorkItem;
    for (const sort of ["manual", "due", "priority", "title", "updated"]) {
      const ordered = [earlierDue, laterDue, running].sort(
        taskPresentationComparator(sort, "en", new Map()),
      );
      expect(ordered[0]?.id).toBe("running");
    }
  });
});
