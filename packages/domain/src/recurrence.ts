import { DomainError, validateSchedule } from "./index";
export interface CalendarRule {
  startDate: string;
  endDate?: string | null;
  timezone: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
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
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: rule.timezone }).format();
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
}
export function localCalendarDay(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
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
    const match =
      rule.frequency === "MONTHLY"
        ? months % rule.interval === 0 && day.getUTCDate() === base.getUTCDate()
        : elapsed % (rule.interval * (rule.frequency === "WEEKLY" ? 7 : 1)) ===
          0;
    if (match) result.push(day.toISOString().slice(0, 10));
  }
  return result;
}
