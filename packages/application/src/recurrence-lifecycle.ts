import { DomainError } from "@arclattice/domain";
import type { RecurrencePayload, WorkflowRecord } from "./workflows";

export function recurrenceDefaults(
  rule: RecurrencePayload,
): RecurrencePayload &
  Required<
    Pick<RecurrencePayload, "state" | "closePolicy" | "closeIncomplete">
  > {
  return {
    ...rule,
    state: rule.state ?? "ACTIVE",
    closePolicy: rule.closePolicy ?? "END_OF_DAY",
    closeIncomplete: rule.closeIncomplete ?? true,
  };
}

export function calendarDateOffset(day: string, days: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

/** Find the actual local day boundary, including 23/25 hour days and skipped midnight. */
export function calendarDayStart(day: string, timezone: string): number {
  const carrier = Date.parse(day + "T00:00:00Z");
  if (!Number.isFinite(carrier)) throw new DomainError("VALIDATION_ERROR");
  if (timezone === "UTC") return carrier;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let low = carrier - 2 * 86400000,
    high = carrier + 2 * 86400000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const parts = formatter.formatToParts(new Date(middle));
    const value = (name: string) =>
      parts.find((part) => part.type === name)?.value ?? "";
    const local =
      value("year").padStart(4, "0") +
      "-" +
      value("month") +
      "-" +
      value("day");
    if (local < day) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function nextOccurrenceDay(
  rule: RecurrencePayload,
  day: string,
): string {
  if (rule.frequency !== "MONTHLY")
    return calendarDateOffset(
      day,
      rule.interval * (rule.frequency === "WEEKLY" ? 7 : 1),
    );
  const base = new Date(day + "T00:00:00Z");
  for (let step = 1; step <= 48; step++) {
    const next = new Date(base);
    next.setUTCDate(1);
    next.setUTCMonth(base.getUTCMonth() + rule.interval * step);
    const month = next.getUTCMonth();
    next.setUTCDate(base.getUTCDate());
    if (next.getUTCMonth() === month) return next.toISOString().slice(0, 10);
  }
  throw new DomainError("VALIDATION_ERROR");
}

export function occurrenceExpiry(rule: RecurrencePayload, day: string): string {
  const start = calendarDayStart(day, rule.timezone);
  switch (rule.closePolicy ?? "END_OF_DAY") {
    case "NEXT_OCCURRENCE":
      return new Date(
        calendarDayStart(nextOccurrenceDay(rule, day), rule.timezone),
      ).toISOString();
    case "DURATION": {
      const value = rule.durationValue;
      if (
        !value ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 366 ||
        !rule.durationUnit
      )
        throw new DomainError("VALIDATION_ERROR");
      return new Date(
        rule.durationUnit === "HOUR"
          ? start + value * 3600000
          : calendarDayStart(
              calendarDateOffset(
                day,
                value * (rule.durationUnit === "WEEK" ? 7 : 1),
              ),
              rule.timezone,
            ),
      ).toISOString();
    }
    case "END_OF_DAY":
      return new Date(
        calendarDayStart(calendarDateOffset(day, 1), rule.timezone) - 1,
      ).toISOString();
  }
}

export function normalizeWorkflowRecords(
  records: WorkflowRecord[],
): WorkflowRecord[] {
  const definitions = new Map(
    records
      .filter((record) => record.payload.kind === "RECURRENCE")
      .map((record) => [record.id, record.payload]),
  );
  return records.map((record) => {
    const payload = record.payload;
    if (payload.kind === "RECURRENCE")
      return { ...record, payload: recurrenceDefaults(payload) };
    if (payload.kind !== "OCCURRENCE") return record;
    const definition = definitions.get(payload.definitionId);
    const rule =
      payload.ruleSnapshot ??
      (definition?.kind === "RECURRENCE" ? definition : undefined);
    return {
      ...record,
      payload: {
        ...payload,
        status: payload.status === "CREATED" ? "OPEN" : payload.status,
        expiresAt:
          payload.expiresAt ??
          (rule
            ? occurrenceExpiry(rule, payload.day)
            : new Date(
                calendarDayStart(calendarDateOffset(payload.day, 1), "UTC") - 1,
              ).toISOString()),
        closedAt:
          payload.closedAt ??
          (payload.status === "MISSED" ? payload.recordedAt : null),
        ...(rule ? { ruleSnapshot: recurrenceDefaults(rule) } : {}),
      },
    };
  });
}
