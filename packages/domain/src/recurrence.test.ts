import { expect, test } from "vitest";
import { localCalendarDay, occurrenceDays } from "./recurrence";

test("natural weekly choices use Monday weeks without changing legacy anchored rules", () => {
  const rule = {
    startDate: "2026-01-07",
    timezone: "UTC",
    frequency: "WEEKLY" as const,
    interval: 2,
  };
  expect(
    occurrenceDays({ ...rule, weekdays: [1, 5] }, "2026-01-07", "2026-01-27"),
  ).toEqual(["2026-01-09", "2026-01-19", "2026-01-23"]);
  expect(occurrenceDays(rule, "2026-01-07", "2026-01-27")).toEqual([
    "2026-01-07",
    "2026-01-21",
  ]);
  for (const weekdays of [[], [0], [8], [1, 1], [1.5]])
    expect(() =>
      occurrenceDays({ ...rule, weekdays }, "2026-01-07", "2026-01-27"),
    ).toThrow("VALIDATION_ERROR");
});

test("monthly ordinal choices skip missing fifth weekdays and support the last weekday", () => {
  const rule = {
    startDate: "2026-01-01",
    timezone: "UTC",
    frequency: "MONTHLY" as const,
    interval: 1,
  };
  expect(
    occurrenceDays(
      {
        ...rule,
        monthlyRule: { kind: "ORDINAL_WEEKDAY", ordinal: 2, weekday: 1 },
      },
      "2026-01-01",
      "2026-03-31",
    ),
  ).toEqual(["2026-01-12", "2026-02-09", "2026-03-09"]);
  expect(
    occurrenceDays(
      {
        ...rule,
        monthlyRule: { kind: "ORDINAL_WEEKDAY", ordinal: 5, weekday: 1 },
      },
      "2026-01-01",
      "2026-03-31",
    ),
  ).toEqual(["2026-03-30"]);
  expect(
    occurrenceDays(
      {
        ...rule,
        monthlyRule: { kind: "ORDINAL_WEEKDAY", ordinal: -1, weekday: 1 },
      },
      "2026-02-01",
      "2026-02-28",
    ),
  ).toEqual(["2026-02-23"]);
  expect(
    occurrenceDays(
      { ...rule, monthlyRule: { kind: "DAY", day: 31 } },
      "2026-01-01",
      "2026-03-31",
    ),
  ).toEqual(["2026-01-31", "2026-03-31"]);
  for (const endAfterCompleted of [0, -1, 1.5, 100001])
    expect(() =>
      occurrenceDays(
        { ...rule, endAfterCompleted },
        "2026-01-01",
        "2026-03-31",
      ),
    ).toThrow("VALIDATION_ERROR");
  expect(() =>
    occurrenceDays(
      { ...rule, endAfterCompleted: 3, endDate: "2026-03-31" },
      "2026-01-01",
      "2026-03-31",
    ),
  ).toThrow("VALIDATION_ERROR");
});

test("calendar day conversion keeps interleaved workspace timezones independent", () => {
  const instant = "2026-03-08T04:30:00Z";
  for (let repeat = 0; repeat < 3; repeat++) {
    expect(localCalendarDay(instant, "America/New_York")).toBe("2026-03-07");
    expect(localCalendarDay(instant, "Asia/Shanghai")).toBe("2026-03-08");
    expect(localCalendarDay(instant, "UTC")).toBe("2026-03-08");
    expect(() => localCalendarDay(instant, "Invalid/Timezone")).toThrow();
  }
  expect(localCalendarDay("2026-03-09T04:30:00Z", "America/New_York")).toBe(
    "2026-03-09",
  );
});

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
