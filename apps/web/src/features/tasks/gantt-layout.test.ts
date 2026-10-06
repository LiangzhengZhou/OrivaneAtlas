import { expect, it } from "vitest";
import { work } from "../../../../../tests/fixtures";
import { ganttDate, ganttDay, ganttLayout } from "./gantt-layout";

it("positions inclusive date spans and due-only milestones without changing entities", () => {
  const tasks = [
    { ...work("span"), startDate: "2026-10-01", dueDate: "2026-10-09" },
    { ...work("milestone"), dueDate: "2026-10-12" },
    work("unscheduled"),
    { ...work("start-only"), startDate: "2026-10-03" },
  ];
  const model = ganttLayout(tasks, "2026-10-05");
  expect(model.rows.map((row) => row.task.id)).toEqual([
    "span",
    "start-only",
    "milestone",
    "unscheduled",
  ]);
  const span = model.rows[0]!;
  expect(span.to! - span.from! + 1).toBe(9);
  expect(model.rows[2]!.milestone).toBe(true);
  expect(model.rows[3]!.unscheduled).toBe(true);
  expect(model.start).toBeLessThanOrEqual(span.from!);
  expect(model.end).toBeGreaterThan(model.rows[2]!.to!);
  expect(tasks[0]!.startDate).toBe("2026-10-01");
});

it("rejects invalid dates and bounds legacy reversed spans while retaining source dates", () => {
  expect(ganttDay("2026-02-30")).toBeNull();
  expect(ganttDate(ganttDay("2024-02-29")!)).toBe("2024-02-29");
  const model = ganttLayout(
    [{ ...work("reverse"), startDate: "2026-10-09", dueDate: "2026-10-01" }],
    "2026-10-05",
  );
  expect(model.rows[0]!.to).toBe(model.rows[0]!.from);
  expect(model.rows[0]!.task.dueDate).toBe("2026-10-01");
});
