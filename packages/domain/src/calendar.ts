import { DomainError, requireDate } from "./index";
export function requireCalendarTimezone(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 100)
    throw new DomainError("VALIDATION_ERROR", { field: "calendarTimezone" });
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    throw new DomainError("VALIDATION_ERROR", { field: "calendarTimezone" });
  }
}
/** Neutral carrier for calendar arithmetic/formatting; always use UTC accessors. */
export function calendarDate(value: string): Date {
  requireDate(value);
  return new Date(value + "T12:00:00Z");
}
export function shiftCalendarMonth(month: string, by: number): string | null {
  const date = calendarDate(month + "-01");
  date.setUTCMonth(date.getUTCMonth() + by, 1);
  return date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999
    ? null
    : date.toISOString().slice(0, 7);
}
export function calendarMonthInfo(month: string): {
  days: number;
  offset: number;
} {
  const first = calendarDate(month + "-01");
  const end = new Date(first);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { days: end.getUTCDate(), offset: (first.getUTCDay() + 6) % 7 };
}
const calendarDateFormatters = new Map<string, Intl.DateTimeFormat>();
export function formatCalendarDate(
  value: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const key = JSON.stringify([locale, options]);
  let formatter = calendarDateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: "UTC",
      calendar: "gregory",
    });
    if (calendarDateFormatters.size >= 64)
      calendarDateFormatters.delete(
        calendarDateFormatters.keys().next().value!,
      );
    calendarDateFormatters.set(key, formatter);
  }
  return formatter.format(calendarDate(value));
}
