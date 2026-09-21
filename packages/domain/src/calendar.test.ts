import { expect, it } from "vitest";
import {
  calendarMonthInfo,
  formatCalendarDate,
  localCalendarDay,
  requireCalendarTimezone,
  shiftCalendarMonth,
} from "./index";

it("uses explicit date boundaries across midnight and DST", () => {
  expect(localCalendarDay("2026-09-17T15:30:00Z", "Asia/Tokyo")).toBe(
    "2026-09-18",
  );
  expect(localCalendarDay("2026-09-17T15:30:00Z", "America/Los_Angeles")).toBe(
    "2026-09-17",
  );
  expect(localCalendarDay("2026-03-08T09:59:59Z", "America/Los_Angeles")).toBe(
    "2026-03-08",
  );
  expect(localCalendarDay("2026-03-08T10:00:00Z", "America/Los_Angeles")).toBe(
    "2026-03-08",
  );
  expect(localCalendarDay("2026-11-01T09:00:00Z", "America/Los_Angeles")).toBe(
    "2026-11-01",
  );
  expect(() => requireCalendarTimezone("Not/AZone")).toThrow(
    "VALIDATION_ERROR",
  );
});
it("calendar arithmetic and display retain small years and leap days", () => {
  expect(calendarMonthInfo("2024-02")).toEqual({ days: 29, offset: 3 });
  expect(calendarMonthInfo("2023-02").days).toBe(28);
  expect(shiftCalendarMonth("0099-12", 1)).toBe("0100-01");
  expect(shiftCalendarMonth("0001-01", -1)).toBe(null);
  expect(shiftCalendarMonth("9999-12", 1)).toBe(null);
  expect(
    formatCalendarDate("2026-09-18", "en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/Adak",
    }),
  ).toBe("Sep 18");
});
