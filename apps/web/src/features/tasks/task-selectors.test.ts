import { expect, it } from "vitest";
import { edge, work } from "../../../../../tests/fixtures";
import { selectTasks } from "./task-selectors";

it("counts only live, unarchived execution-active tasks across projections", () => {
  const items = [
    work("now"),
    { ...work("later"), activationState: "INACTIVE" as const },
    { ...work("milestone"), type: "MILESTONE" as const },
    { ...work("goal"), type: "GOAL" as const },
    { ...work("done"), status: "DONE" as const },
    { ...work("deleted"), deletedAt: "2026-09-23" },
    work("archived"),
    {
      ...work("scheduled"),
      activationState: "SCHEDULED" as const,
      activationPolicy: "AT_SCHEDULED_TIME" as const,
      startDate: "2026-09-24",
    },
  ];
  const selection = selectTasks(
    items,
    [],
    "2026-09-23",
    (item) => item.id === "archived",
  );
  expect(selection.openActiveTasks.map((item) => item.id)).toEqual(["now"]);
  expect(selection.readyTasks.map((item) => item.id)).toEqual(["now"]);
  expect(selection.completedTasks.map((item) => item.id)).toEqual(["done"]);
  expect(selection.laterTasks.map((item) => item.id)).toEqual(["later"]);
  expect(selection.scheduledTasks.map((item) => item.id)).toEqual([
    "scheduled",
  ]);
});

it("retains blockers outside the visible list and unlocks on their completion", () => {
  const items = [work("prerequisite"), work("dependent")];
  const edges = [edge("prerequisite", "dependent")];
  const hidden = (item: ReturnType<typeof work>) => item.id === "prerequisite";
  expect(selectTasks(items, edges, "2026-09-23", hidden).readyTasks).toEqual(
    [],
  );
  const completed = [{ ...items[0]!, status: "DONE" as const }, items[1]!];
  expect(
    selectTasks(completed, edges, "2026-09-23", hidden).readyTasks.map(
      (item) => item.id,
    ),
  ).toEqual(["dependent"]);
});
