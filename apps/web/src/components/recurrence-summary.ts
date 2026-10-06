import { formatCalendarDate } from "@arclattice/domain";

export function recurrenceSummary(
  rule: {
    frequency: "DAILY" | "WEEKLY" | "MONTHLY";
    interval: number;
    timezone: string;
    endDate?: string | null;
  },
  language: string,
) {
  const zh = language.startsWith("zh");
  const units = zh
    ? { DAILY: "天", WEEKLY: "周", MONTHLY: "月" }
    : { DAILY: "day", WEEKLY: "week", MONTHLY: "month" };
  const unit = units[rule.frequency];
  const schedule = zh
    ? `每${rule.interval === 1 ? "" : rule.interval}${unit}`
    : `Every ${rule.interval === 1 ? unit : `${rule.interval} ${unit}s`}`;
  const end = rule.endDate
    ? `${zh ? "到" : "Until"} ${formatCalendarDate(rule.endDate, language, { month: "short", day: "numeric" })}`
    : zh
      ? "持续重复"
      : "No end date";
  return `${schedule} · ${rule.timezone} · ${end}`;
}
