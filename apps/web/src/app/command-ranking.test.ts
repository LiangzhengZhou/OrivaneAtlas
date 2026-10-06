import { expect, test } from "vitest";
import { commandScore } from "./command-ranking";

test("command ranking supports ordered fuzzy matching and localized text", () => {
  expect(commandScore("New task", "nt")).toBeGreaterThan(0);
  expect(commandScore("New task", "tn")).toBe(-1);
  expect(commandScore("新建任务", "建任")).toBeGreaterThan(0);
  expect(commandScore("New task", "new")).toBeGreaterThan(
    commandScore("Create new task", "new"),
  );
  expect(commandScore("TASK", "task")).toBe(1000);
});
