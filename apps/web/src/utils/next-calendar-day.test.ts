import { expect, test } from "vitest";
import { nextCalendarDayInstant } from "./next-calendar-day";

test("next day uses workspace midnight including DST rather than 24-hour intervals", () => {
  expect(
    new Date(
      nextCalendarDayInstant(
        Date.parse("2026-10-04T01:00:00Z"),
        "Asia/Shanghai",
      ),
    ).toISOString(),
  ).toBe("2026-10-04T16:00:00.000Z");
  expect(
    new Date(
      nextCalendarDayInstant(
        Date.parse("2026-03-08T05:30:00Z"),
        "America/New_York",
      ),
    ).toISOString(),
  ).toBe("2026-03-09T04:00:00.000Z");
});
