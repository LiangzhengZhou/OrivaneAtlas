import { localCalendarDay } from "@arclattice/domain";

export function nextCalendarDayInstant(now: number, timezone: string): number {
  const day = localCalendarDay(new Date(now).toISOString(), timezone);
  let low = now,
    high = now + 48 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localCalendarDay(new Date(middle).toISOString(), timezone) === day)
      low = middle;
    else high = middle;
  }
  return high;
}
