import { expect, test } from "vitest";
import { calendarMonth, formatDateField } from "./date-format";

test("localized date is independent of host timezone and retains early years", () => {
  expect(formatDateField("2026-10-03", "zh-CN")).toBe("2026年10月3日");
  expect(formatDateField("2026-10-03", "en-US")).toBe("Oct 3, 2026");
  expect(formatDateField("", "zh-CN")).toBe("年 / 月 / 日");
  expect(formatDateField("", "en-US")).toBe("MM / DD / YYYY");
  expect(formatDateField("0001-01-01", "en-US")).toBe("Jan 1, 1");
});
test("Gregorian calendar handles century leap years and early years", () => {
  expect(calendarMonth(2024, 2).days).toBe(29);
  expect(calendarMonth(2100, 2).days).toBe(28);
  expect(calendarMonth(2000, 2).days).toBe(29);
  expect(calendarMonth(1, 1).first.getUTCFullYear()).toBe(1);
});
