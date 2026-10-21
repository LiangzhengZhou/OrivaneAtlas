import { DomainError, validateSchedule } from "./index";
export interface CalendarRule {
  startDate: string;
  endDate?: string | null;
  timezone: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  /** ISO weekdays, Monday=1. Omitted preserves the historical start-day rule. */
  weekdays?: number[];
  monthlyRule?:
    | { kind: "DAY"; day: number }
    | { kind: "ORDINAL_WEEKDAY"; ordinal: number; weekday: number };
  endAfterCompleted?: number | null;
}
export function validateCalendarRule(rule: CalendarRule): void {
  validateSchedule(rule.startDate, rule.endDate ?? rule.startDate);
  if (
    !rule.startDate ||
    typeof rule.timezone !== "string" ||
    !rule.timezone.trim() ||
    !["DAILY", "WEEKLY", "MONTHLY"].includes(rule.frequency) ||
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > 366
  )
    throw new DomainError("VALIDATION_ERROR");
  if (
    (rule.weekdays !== undefined &&
      (rule.frequency !== "WEEKLY" ||
        !Array.isArray(rule.weekdays) ||
        rule.weekdays.length === 0 ||
        rule.weekdays.length > 7 ||
        new Set(rule.weekdays).size !== rule.weekdays.length ||
        rule.weekdays.some(
          (day) => !Number.isInteger(day) || day < 1 || day > 7,
        ))) ||
    (rule.endAfterCompleted != null &&
      (!Number.isInteger(rule.endAfterCompleted) ||
        rule.endAfterCompleted < 1 ||
        rule.endAfterCompleted > 100000 ||
        !!rule.endDate))
  )
    throw new DomainError("VALIDATION_ERROR");
  if (rule.monthlyRule !== undefined) {
    const monthly = rule.monthlyRule;
    if (
      !monthly ||
      rule.frequency !== "MONTHLY" ||
      (monthly.kind === "DAY"
        ? !Number.isInteger(monthly.day) || monthly.day < 1 || monthly.day > 31
        : monthly.kind !== "ORDINAL_WEEKDAY" ||
          !Number.isInteger(monthly.ordinal) ||
          ![-1, 1, 2, 3, 4, 5].includes(monthly.ordinal) ||
          !Number.isInteger(monthly.weekday) ||
          monthly.weekday < 1 ||
          monthly.weekday > 7)
    )
      throw new DomainError("VALIDATION_ERROR");
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: rule.timezone }).format();
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
}
const calendarDayFormatters = new Map<string, Intl.DateTimeFormat>();
export function localCalendarDay(instant: string, timezone: string): string {
  let formatter = calendarDayFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // Only immutable formatting machinery is cached, never workspace data.
    if (calendarDayFormatters.size >= 32)
      calendarDayFormatters.delete(calendarDayFormatters.keys().next().value!);
    calendarDayFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** Enumerate calendar dates, not 24-hour intervals in a timezone (DST safe). */
export function occurrenceDays(
  rule: CalendarRule,
  from: string,
  to: string,
): string[] {
  validateCalendarRule(rule);
  validateSchedule(from, to);
  const start = Date.parse(rule.startDate + "T00:00:00Z"),
    first = Date.parse(from + "T00:00:00Z"),
    last = Date.parse(to + "T00:00:00Z");
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    (last - first) / 86400000 > 365
  )
    throw new DomainError("VALIDATION_ERROR");
  const result: string[] = [];
  const base = new Date(start);
  for (let time = first; time <= last; time += 86400000) {
    if (
      time < start ||
      (rule.endDate && new Date(time).toISOString().slice(0, 10) > rule.endDate)
    )
      continue;
    const day = new Date(time),
      elapsed = (time - start) / 86400000;
    const months =
      (day.getUTCFullYear() - base.getUTCFullYear()) * 12 +
      day.getUTCMonth() -
      base.getUTCMonth();
    const weekday = day.getUTCDay() || 7;
    const monthlyMatch =
      rule.monthlyRule?.kind === "ORDINAL_WEEKDAY"
        ? weekday === rule.monthlyRule.weekday &&
          (rule.monthlyRule.ordinal === -1
            ? new Date(time + 7 * 86400000).getUTCMonth() !== day.getUTCMonth()
            : Math.ceil(day.getUTCDate() / 7) === rule.monthlyRule.ordinal)
        : day.getUTCDate() === (rule.monthlyRule?.day ?? base.getUTCDate());
    const week = Math.floor((elapsed + ((base.getUTCDay() || 7) - 1)) / 7);
    const match =
      rule.frequency === "MONTHLY"
        ? months % rule.interval === 0 && monthlyMatch
        : rule.frequency === "WEEKLY" && rule.weekdays
          ? week % rule.interval === 0 && rule.weekdays.includes(weekday)
          : elapsed %
              (rule.interval * (rule.frequency === "WEEKLY" ? 7 : 1)) ===
            0;
    if (match) result.push(day.toISOString().slice(0, 10));
  }
  return result;
}
