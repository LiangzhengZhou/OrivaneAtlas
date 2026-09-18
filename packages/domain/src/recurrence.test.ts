import { expect, test } from "vitest";
import { localCalendarDay, occurrenceDays } from "./recurrence";

test("end dates are inclusive and reject invalid ranges", () => {
  const rule = {
    startDate: "2026-03-07",
    endDate: "2026-03-09",
    timezone: "America/New_York",
    frequency: "DAILY" as const,
    interval: 1,
  };
  expect(occurrenceDays(rule, "2026-03-07", "2026-03-12")).toEqual([
    "2026-03-07",
    "2026-03-08",
    "2026-03-09",
  ]);
  expect(occurrenceDays(rule, "2026-03-10", "2026-03-12")).toEqual([]);
  for (const endDate of ["2026-03-06", "2026-02-30", "bad"])
    expect(() =>
      occurrenceDays({ ...rule, endDate }, "2026-03-07", "2026-03-12"),
    ).toThrow("VALIDATION_ERROR");
});

test("calendar recurrence skips absent month days and remains stable through DST", () => {
  const base = {
    startDate: "2026-01-31",
    timezone: "America/New_York",
    frequency: "MONTHLY" as const,
    interval: 1,
  };
  expect(occurrenceDays(base, "2026-01-01", "2026-04-30")).toEqual([
    "2026-01-31",
    "2026-03-31",
  ]);
  expect(
    occurrenceDays(
      { ...base, frequency: "DAILY", startDate: "2026-03-07" },
      "2026-03-07",
      "2026-03-10",
    ),
  ).toHaveLength(4);
  expect(localCalendarDay("2026-03-08T04:30:00Z", base.timezone)).toBe(
    "2026-03-07",
  );
  expect(localCalendarDay("2026-03-09T04:30:00Z", base.timezone)).toBe(
    "2026-03-09",
  );
  expect(() =>
    occurrenceDays({ ...base, interval: 0 }, "2026-01-01", "2026-04-30"),
  ).toThrow("VALIDATION_ERROR");
  for (const timezone of ["", "   ", undefined]) {
    expect(() =>
      occurrenceDays(
        { ...base, timezone: timezone as string },
        "2026-01-01",
        "2026-04-30",
      ),
    ).toThrow("VALIDATION_ERROR");
  }
  expect(() =>
    occurrenceDays(
      { ...base, timezone: "invalid" },
      "2026-01-01",
      "2026-04-30",
    ),
  ).toThrow("VALIDATION_ERROR");
});
